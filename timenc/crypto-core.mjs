(() => {
'use strict';

/**
 * Time Encrypt 浏览器端密码核心（原型）。
 *
 * 设计目标：相同口令在不同分钟派生不同 AES 密钥，密文中携带受认证保护
 * 的签发时间，从而在不保存单条记录的情况下判断 15 分钟有效期。
 *
 * 注意：算法可以公开，安全性应来自高强度共享口令/服务端主密钥，而不是
 * 隐藏源代码。生产环境还必须使用服务端可信时间。
 */

// ---- 可配置参数 -----------------------------------------------------------
// 修改这些参数后，派生长度会自动重新计算；页面文案和 README 仍需同步更新。
const MAX_AGE_SECONDS = 900;
const PBKDF2_ITERATIONS = 120000;
const PROTOCOL_VERSION = 2;
const FRAME_LENGTH = 48;
const FRAME_HEADER_LENGTH = 5; // 4 字节签发时间 + 1 字节明文长度
const IV_LENGTH = 12;          // AES-GCM 推荐的 96-bit IV
const AUTH_TAG_LENGTH = 16;    // Web Crypto AES-GCM 默认 128-bit 认证标签
const VERSION_LENGTH = 1;
const TOKEN_GROUP_SIZE = 4;

// ---- 自动派生的格式参数：通常不应手工修改 --------------------------------
const MAX_MESSAGE_BYTES = FRAME_LENGTH - FRAME_HEADER_LENGTH;
const PACKED_LENGTH = VERSION_LENGTH + IV_LENGTH + FRAME_LENGTH + AUTH_TAG_LENGTH;
const TOKEN_RAW_LENGTH = Math.ceil((PACKED_LENGTH * 8) / Math.log2(62));
const MAX_MINUTE_OFFSET = Math.ceil(MAX_AGE_SECONDS / 60);

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

/** 合并多个 Uint8Array，不依赖 Node.js Buffer，确保浏览器可直接运行。 */
function concatBytes(...parts) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

function uint32Bytes(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

/** 将固定长度二进制数据编码为只包含 0-9/A-Z/a-z 的 Base62。 */
function bytesToBase62(bytes) {
  let number = 0n;
  for (const byte of bytes) number = (number << 8n) | BigInt(byte);
  let result = '';
  while (number > 0n) {
    result = ALPHABET[Number(number % 62n)] + result;
    number /= 62n;
  }
  return result.padStart(TOKEN_RAW_LENGTH, '0');
}

/** Base62 逆变换；byteLength 用于恢复编码时被省略的前导零。 */
function base62ToBytes(value, byteLength) {
  let number = 0n;
  for (const char of value) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error('密文包含无效字符');
    number = number * 62n + BigInt(index);
  }
  const output = new Uint8Array(byteLength);
  for (let index = byteLength - 1; index >= 0; index--) {
    output[index] = Number(number & 255n);
    number >>= 8n;
  }
  if (number !== 0n) throw new Error('密文数值超出范围');
  return output;
}

function formatToken(raw) {
  const groups = [];
  for (let offset = 0; offset < raw.length; offset += TOKEN_GROUP_SIZE) {
    groups.push(raw.slice(offset, offset + TOKEN_GROUP_SIZE));
  }
  return groups.join('-');
}

function cleanToken(token) {
  return token.replace(/[-\s]/g, '');
}

async function deriveMaster(secret) {
  // PBKDF2 用于提高离线猜口令的成本。固定盐用于协议区分，不替代强口令。
  const material = await crypto.subtle.importKey('raw', encoder.encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    salt: encoder.encode('TimeEncrypt/v2/browser-prototype'),
    iterations: PBKDF2_ITERATIONS,
    hash: 'SHA-256'
  }, material, 256);
  return crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
}

async function deriveMinuteKey(master, minute) {
  // 每个 Unix 分钟编号对应一个独立 AES 密钥，无需保存历史分钟密钥。
  return crypto.subtle.deriveKey({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: uint32Bytes(minute),
    info: encoder.encode('TimeEncrypt/minute-key/v2')
  }, master, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function encryptMessage(secret, message) {
  const data = encoder.encode(message);
  if (!data.length) throw new Error('请输入要加密的内容');
  if (data.length > MAX_MESSAGE_BYTES) throw new Error(`内容不能超过 ${MAX_MESSAGE_BYTES} 个 UTF-8 字节`);

  const issuedAt = Math.floor(Date.now() / 1000);
  const minute = Math.floor(issuedAt / 60);
  // 数据帧长度固定，未使用空间填入随机字节，避免密文长度泄露明文长度。
  const frame = new Uint8Array(FRAME_LENGTH);
  frame.set(uint32Bytes(issuedAt), 0);
  frame[4] = data.length;
  frame.set(data, 5);
  crypto.getRandomValues(frame.subarray(5 + data.length));

  // 同一个分钟密钥可能加密多条消息，所以每条消息必须使用新的随机 IV。
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const master = await deriveMaster(secret);
  const key = await deriveMinuteKey(master, minute);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, frame));
  const packed = concatBytes(Uint8Array.of(PROTOCOL_VERSION), iv, encrypted);
  return { token: formatToken(bytesToBase62(packed)), issuedAt };
}

async function decryptMessage(secret, formattedToken) {
  const raw = cleanToken(formattedToken);
  const expectedGroups = Math.ceil(TOKEN_RAW_LENGTH / TOKEN_GROUP_SIZE);
  if (raw.length !== TOKEN_RAW_LENGTH) {
    throw new Error(`密文长度不正确，应为 ${expectedGroups} 组 × ${TOKEN_GROUP_SIZE} 位`);
  }
  const packed = base62ToBytes(raw, PACKED_LENGTH);
  if (packed[0] !== PROTOCOL_VERSION) throw new Error('不支持此密文版本');

  const iv = packed.slice(VERSION_LENGTH, VERSION_LENGTH + IV_LENGTH);
  const encrypted = packed.slice(VERSION_LENGTH + IV_LENGTH);
  const master = await deriveMaster(secret);
  const currentMinute = Math.floor(Date.now() / 60000);

  // 尝试有效期覆盖到的分钟窗口；AES-GCM 认证失败时继续尝试上一分钟。
  for (let offset = 0; offset <= MAX_MINUTE_OFFSET; offset++) {
    try {
      const key = await deriveMinuteKey(master, currentMinute - offset);
      const frame = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted));
      const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
      const issuedAt = view.getUint32(0, false);
      const age = Math.floor(Date.now() / 1000) - issuedAt;
      if (age < -90) throw new Error('密文时间异常');
      if (age >= MAX_AGE_SECONDS) throw new Error('密文已超过有效期');
      const length = frame[4];
      if (length > MAX_MESSAGE_BYTES) throw new Error('密文数据损坏');
      return { message: decoder.decode(frame.slice(5, 5 + length)), issuedAt };
    } catch (error) {
      if (/超过有效期|时间异常|数据损坏/.test(error.message)) throw error;
    }
  }
  throw new Error('无法解密：口令错误、密文损坏或已经过期');
}

globalThis.TimeCrypto = {
  TOKEN_RAW_LENGTH,
  MAX_MESSAGE_BYTES,
  MAX_AGE_SECONDS,
  PBKDF2_ITERATIONS,
  PROTOCOL_VERSION,
  encryptMessage,
  decryptMessage
};

})();
