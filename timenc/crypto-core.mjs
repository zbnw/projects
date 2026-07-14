(() => {
  'use strict';

  /**
   * Time Encrypt 浏览器端密码核心。
   *
   * v3 保持 129 位密文外观不变，但把随机 IV 同时绑定到 PBKDF2 盐，避免同一
   * 口令在多条密文间复用同一个主密钥；版本与协议域也作为 AES-GCM 附加认证
   * 数据参与校验。v2 仅保留解密能力，用于升级后的一刻钟平滑迁移。
   *
   * 这是公开协议。安全性来自高强度共享口令和标准密码原语，不来自隐藏代码。
   * 纯前端版本依赖本机时间，生产环境必须迁移到可信服务端时间与服务端密钥。
   */

  // ---- 协议配置：改变派生、帧、编码或认证参数时必须发布新协议版本 ----------
  const MAX_AGE_SECONDS = 900;
  const MAX_CLOCK_SKEW_SECONDS = 90;
  const MIN_SECRET_CHARACTERS = 8;
  const MAX_SECRET_BYTES = 256;
  const PBKDF2_ITERATIONS = 600000;
  const PROTOCOL_VERSION = 3;
  const LEGACY_PROTOCOL_VERSION = 2;
  const LEGACY_PBKDF2_ITERATIONS = 120000;
  // v3 发布后的迁移宽限期；超过此绝对时间后不再接受旧 v2 密文。
  const LEGACY_V2_ACCEPT_UNTIL = 1784034382; // 2026-07-14 21:06:22 +08:00
  const FRAME_LENGTH = 48;
  const FRAME_HEADER_LENGTH = 5; // 4 字节签发时间 + 1 字节明文长度
  const IV_LENGTH = 12;          // AES-GCM 推荐的 96-bit IV
  const AUTH_TAG_LENGTH = 16;    // 128-bit 认证标签
  const VERSION_LENGTH = 1;
  const TOKEN_GROUP_SIZE = 4;

  // ---- 自动派生的格式参数：通常不应手工修改 -------------------------------
  const MAX_MESSAGE_BYTES = FRAME_LENGTH - FRAME_HEADER_LENGTH;
  const PACKED_LENGTH = VERSION_LENGTH + IV_LENGTH + FRAME_LENGTH + AUTH_TAG_LENGTH;
  const TOKEN_RAW_LENGTH = Math.ceil((PACKED_LENGTH * 8) / Math.log2(62));
  const TOKEN_GROUP_COUNT = Math.ceil(TOKEN_RAW_LENGTH / TOKEN_GROUP_SIZE);
  const TOKEN_FORMATTED_LENGTH = TOKEN_RAW_LENGTH + TOKEN_GROUP_COUNT - 1;
  const MAX_PAST_MINUTE_OFFSET = Math.ceil(MAX_AGE_SECONDS / 60);
  const MAX_FUTURE_MINUTE_OFFSET = Math.ceil(MAX_CLOCK_SKEW_SECONDS / 60);

  const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const TOKEN_CHARACTERS = /^[0-9A-Za-z]+$/;
  const V2_PBKDF2_SALT = 'TimeEncrypt/v2/browser-prototype';
  const V2_HKDF_INFO = 'TimeEncrypt/minute-key/v2';
  const V3_PBKDF2_DOMAIN = 'TimeEncrypt/v3/per-token/';
  const V3_HKDF_INFO = 'TimeEncrypt/minute-key/v3';
  const V3_AUTH_CONTEXT = 'TimeEncrypt/ciphertext/v3';
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: true });

  function assertProtocolInvariants() {
    const valid = PACKED_LENGTH === 77
      && TOKEN_RAW_LENGTH === 104
      && TOKEN_GROUP_COUNT === 26
      && TOKEN_FORMATTED_LENGTH === 129
      && MAX_MESSAGE_BYTES > 0
      && MAX_MESSAGE_BYTES <= 255;
    if (!valid) throw new Error('Time Encrypt v3 协议长度不变量校验失败');
  }

  class TimeCryptoError extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'TimeCryptoError';
      this.code = code;
    }
  }

  function fail(code, message) {
    throw new TimeCryptoError(code, message);
  }

  /** 合并多个 Uint8Array，不依赖 Node.js Buffer。 */
  function concatBytes(...parts) {
    const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) {
      output.set(part, offset);
      offset += part.length;
    }
    return output;
  }

  function uint32Bytes(value) {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, false);
    return bytes;
  }

  function ensureCryptoSupport() {
    if (!globalThis.crypto?.subtle || typeof globalThis.crypto.getRandomValues !== 'function') {
      fail('UNSUPPORTED_BROWSER', '当前浏览器不支持所需的 Web Crypto API');
    }
  }

  function validateV3Secret(secret) {
    if (typeof secret !== 'string') fail('INVALID_SECRET', '请输入共享口令');
    if ([...secret].length < MIN_SECRET_CHARACTERS) {
      fail('SECRET_TOO_SHORT', `共享口令至少需要 ${MIN_SECRET_CHARACTERS} 个字符`);
    }
    if (encoder.encode(secret).length > MAX_SECRET_BYTES) {
      fail('SECRET_TOO_LONG', `共享口令不能超过 ${MAX_SECRET_BYTES} 个 UTF-8 字节`);
    }
  }

  /** v2 曾按 UTF-16 code unit 计数且没有字节上限；迁移期必须保留旧语义。 */
  function validateV2Secret(secret) {
    if (typeof secret !== 'string' || secret.length < MIN_SECRET_CHARACTERS) {
      fail('SECRET_TOO_SHORT', `共享口令至少需要 ${MIN_SECRET_CHARACTERS} 位`);
    }
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
    for (const character of value) {
      const alphabetIndex = ALPHABET.indexOf(character);
      if (alphabetIndex < 0) fail('INVALID_TOKEN', '密文包含无效字符');
      number = number * 62n + BigInt(alphabetIndex);
    }

    const output = new Uint8Array(byteLength);
    for (let index = byteLength - 1; index >= 0; index -= 1) {
      output[index] = Number(number & 255n);
      number >>= 8n;
    }
    if (number !== 0n) fail('INVALID_TOKEN', '密文数值超出协议范围');
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
    return String(token ?? '').replace(/[\s-]/g, '');
  }

  /**
   * 供界面层使用的唯一密文格式化入口，避免 UI 复制协议分组规则。
   * 无效字符不会被静默删除，最终由 decryptMessage 给出明确错误。
   */
  function inspectTokenInput(token) {
    const raw = cleanToken(token);
    return Object.freeze({
      rawLength: raw.length,
      formatted: formatToken(raw),
      complete: raw.length === TOKEN_RAW_LENGTH,
      validCharacters: raw.length === 0 || TOKEN_CHARACTERS.test(raw)
    });
  }

  async function deriveMaster(secret, iv, version) {
    const material = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      'PBKDF2',
      false,
      ['deriveBits']
    );

    // v3 使用公开随机 IV 作为每条密文唯一盐的一部分，阻止跨密文摊薄猜口令成本。
    const salt = version === PROTOCOL_VERSION
      ? concatBytes(encoder.encode(V3_PBKDF2_DOMAIN), iv)
      : encoder.encode(V2_PBKDF2_SALT);
    const iterations = version === PROTOCOL_VERSION
      ? PBKDF2_ITERATIONS
      : LEGACY_PBKDF2_ITERATIONS;
    const bits = await crypto.subtle.deriveBits({
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256'
    }, material, 256);
    return crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  }

  async function deriveMinuteKey(master, minute, version) {
    const info = version === PROTOCOL_VERSION ? V3_HKDF_INFO : V2_HKDF_INFO;
    return crypto.subtle.deriveKey({
      name: 'HKDF',
      hash: 'SHA-256',
      salt: uint32Bytes(minute),
      info: encoder.encode(info)
    }, master, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  function aesParameters(iv, version) {
    const parameters = { name: 'AES-GCM', iv, tagLength: AUTH_TAG_LENGTH * 8 };
    if (version === PROTOCOL_VERSION) {
      parameters.additionalData = concatBytes(
        Uint8Array.of(version),
        encoder.encode(V3_AUTH_CONTEXT)
      );
    }
    return parameters;
  }

  function decodeFrame(frame, candidateMinute, nowSeconds) {
    if (frame.length !== FRAME_LENGTH) fail('CORRUPT_TOKEN', '密文数据损坏');
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    const issuedAt = view.getUint32(0, false);
    const age = nowSeconds - issuedAt;

    if (Math.floor(issuedAt / 60) !== candidateMinute) {
      fail('CORRUPT_TOKEN', '密文时间与密钥窗口不一致');
    }
    if (age < -MAX_CLOCK_SKEW_SECONDS) fail('INVALID_TIME', '密文时间异常');
    if (age >= MAX_AGE_SECONDS) fail('EXPIRED_TOKEN', '密文已超过一刻钟有效期');

    const messageLength = frame[4];
    if (messageLength < 1 || messageLength > MAX_MESSAGE_BYTES) {
      fail('CORRUPT_TOKEN', '密文数据损坏');
    }

    try {
      return {
        message: decoder.decode(frame.slice(FRAME_HEADER_LENGTH, FRAME_HEADER_LENGTH + messageLength)),
        issuedAt
      };
    } catch {
      fail('CORRUPT_TOKEN', '密文数据损坏');
    }
  }

  async function encryptMessage(secret, message) {
    ensureCryptoSupport();
    validateV3Secret(secret);

    const data = encoder.encode(String(message ?? ''));
    if (!data.length) fail('EMPTY_MESSAGE', '请输入要加密的内容');
    if (data.length > MAX_MESSAGE_BYTES) {
      fail('MESSAGE_TOO_LONG', `内容不能超过 ${MAX_MESSAGE_BYTES} 个 UTF-8 字节`);
    }

    const issuedAt = Math.floor(Date.now() / 1000);
    const minute = Math.floor(issuedAt / 60);
    const frame = new Uint8Array(FRAME_LENGTH);
    frame.set(uint32Bytes(issuedAt), 0);
    frame[4] = data.length;
    frame.set(data, FRAME_HEADER_LENGTH);
    crypto.getRandomValues(frame.subarray(FRAME_HEADER_LENGTH + data.length));

    // 每条消息先生成随机 IV，再用它绑定本条密文的口令派生与 AES-GCM 认证。
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const master = await deriveMaster(secret, iv, PROTOCOL_VERSION);
    const key = await deriveMinuteKey(master, minute, PROTOCOL_VERSION);
    const encrypted = new Uint8Array(await crypto.subtle.encrypt(
      aesParameters(iv, PROTOCOL_VERSION),
      key,
      frame
    ));
    const packed = concatBytes(Uint8Array.of(PROTOCOL_VERSION), iv, encrypted);

    return {
      token: formatToken(bytesToBase62(packed)),
      issuedAt,
      version: PROTOCOL_VERSION
    };
  }

  async function decryptMessage(secret, formattedToken) {
    ensureCryptoSupport();

    const raw = cleanToken(formattedToken);
    if (raw.length !== TOKEN_RAW_LENGTH) {
      fail('INVALID_TOKEN_LENGTH', `密文应为 ${TOKEN_GROUP_COUNT} 组 × ${TOKEN_GROUP_SIZE} 位`);
    }
    if (!TOKEN_CHARACTERS.test(raw)) fail('INVALID_TOKEN', '密文只能包含大小写字母和数字');

    const packed = base62ToBytes(raw, PACKED_LENGTH);
    const version = packed[0];
    if (version !== PROTOCOL_VERSION && version !== LEGACY_PROTOCOL_VERSION) {
      fail('UNSUPPORTED_VERSION', '不支持此密文版本');
    }

    // 整个解密过程只读取一次时间，避免跨秒/跨分钟时不同检查使用不同基准。
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (version === LEGACY_PROTOCOL_VERSION) {
      if (nowSeconds > LEGACY_V2_ACCEPT_UNTIL) fail('UNSUPPORTED_VERSION', 'v2 密文迁移期已结束');
      validateV2Secret(secret);
    } else {
      validateV3Secret(secret);
    }

    const iv = packed.slice(VERSION_LENGTH, VERSION_LENGTH + IV_LENGTH);
    const encrypted = packed.slice(VERSION_LENGTH + IV_LENGTH);
    const master = await deriveMaster(secret, iv, version);
    const currentMinute = Math.floor(nowSeconds / 60);

    // 同时尝试允许的轻微未来窗口，修复接收方时钟稍慢并跨分钟时无法解密的问题。
    for (
      let candidateMinute = currentMinute + MAX_FUTURE_MINUTE_OFFSET;
      candidateMinute >= currentMinute - MAX_PAST_MINUTE_OFFSET;
      candidateMinute -= 1
    ) {
      try {
        const key = await deriveMinuteKey(master, candidateMinute, version);
        const frame = new Uint8Array(await crypto.subtle.decrypt(
          aesParameters(iv, version),
          key,
          encrypted
        ));
        return {
          ...decodeFrame(frame, candidateMinute, nowSeconds),
          version
        };
      } catch (error) {
        if (error instanceof TimeCryptoError) throw error;
        // AES-GCM 的 OperationError 表示该分钟密钥未通过认证；继续尝试相邻窗口。
        if (error?.name === 'OperationError') continue;
        fail('CRYPTO_FAILURE', '当前浏览器无法完成安全计算');
      }
    }

    fail('AUTHENTICATION_FAILED', '无法解密：口令错误、密文损坏或已经过期');
  }

  assertProtocolInvariants();

  globalThis.TimeCrypto = Object.freeze({
    MAX_AGE_SECONDS,
    MAX_CLOCK_SKEW_SECONDS,
    MAX_MESSAGE_BYTES,
    MIN_SECRET_CHARACTERS,
    MAX_SECRET_BYTES,
    PBKDF2_ITERATIONS,
    PROTOCOL_VERSION,
    LEGACY_PROTOCOL_VERSION,
    TOKEN_RAW_LENGTH,
    TOKEN_GROUP_COUNT,
    TOKEN_GROUP_SIZE,
    TOKEN_FORMATTED_LENGTH,
    inspectTokenInput,
    encryptMessage,
    decryptMessage
  });
})();

