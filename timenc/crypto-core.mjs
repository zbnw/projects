(() => {
  'use strict';

  /**
   * Time Encrypt 密码核心。
   *
   * v4 是口令保护模式；v5 是免口令便捷模式。两者都要求调用方显式传入
   * 经过服务器校准的 Unix 秒，核心中绝不读取设备时钟。这样可以在测试中精确
   * 验证 899/900 秒边界，也避免用户修改本机时间绕过页面的有效期检查。
   *
   * 重要：v5 的密钥材料全部包含在密文中，任何拿到密文的人都能解开。它只提供
   * 固定格式、时效检查和传输损坏检测，不提供秘密性。真正的无口令保密必须依赖
   * 后端持有、不下发给浏览器的主密钥。
   */

  // 修改帧、派生域、认证参数或有效期时，必须发布新协议版本并补齐边界测试。
  const MAX_AGE_SECONDS = 900;
  const MAX_CLOCK_SKEW_SECONDS = 5;
  const MIN_SECRET_CHARACTERS = 8;
  const MAX_SECRET_BYTES = 256;
  const PBKDF2_ITERATIONS = 600000;
  const PROTECTED_VERSION = 4;
  const CONVENIENCE_VERSION = 5;
  const LEGACY_PROTECTED_VERSION = 3;

  const FRAME_LENGTH = 48;
  const FRAME_HEADER_LENGTH = 5;
  const IV_LENGTH = 12;
  const AUTH_TAG_LENGTH = 16;
  const VERSION_LENGTH = 1;
  const TOKEN_GROUP_SIZE = 4;
  const MAX_MESSAGE_BYTES = FRAME_LENGTH - FRAME_HEADER_LENGTH;
  const PACKED_LENGTH = VERSION_LENGTH + IV_LENGTH + FRAME_LENGTH + AUTH_TAG_LENGTH;
  const TOKEN_RAW_LENGTH = Math.ceil((PACKED_LENGTH * 8) / Math.log2(62));
  const TOKEN_GROUP_COUNT = Math.ceil(TOKEN_RAW_LENGTH / TOKEN_GROUP_SIZE);
  const TOKEN_FORMATTED_LENGTH = TOKEN_RAW_LENGTH + TOKEN_GROUP_COUNT - 1;
  const MAX_PAST_MINUTE_OFFSET = Math.ceil(MAX_AGE_SECONDS / 60);
  const MAX_FUTURE_MINUTE_OFFSET = Math.ceil(MAX_CLOCK_SKEW_SECONDS / 60);

  const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const TOKEN_CHARACTERS = /^[0-9A-Za-z]+$/;
  const V3_PBKDF2_DOMAIN = 'TimeEncrypt/v3/per-token/';
  const V3_HKDF_INFO = 'TimeEncrypt/minute-key/v3';
  const V3_AUTH_CONTEXT = 'TimeEncrypt/ciphertext/v3';
  const V4_PBKDF2_DOMAIN = 'TimeEncrypt/v4/protected/per-token/';
  const V4_HKDF_INFO = 'TimeEncrypt/minute-key/v4/protected';
  const V4_AUTH_CONTEXT = 'TimeEncrypt/ciphertext/v4/protected';
  const V5_HKDF_INFO = 'TimeEncrypt/minute-key/v5/convenience';
  const V5_AUTH_CONTEXT = 'TimeEncrypt/ciphertext/v5/convenience-public';
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: true });

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

  function assertProtocolInvariants() {
    if (PACKED_LENGTH !== 77 || TOKEN_RAW_LENGTH !== 104 ||
        TOKEN_GROUP_COUNT !== 26 || TOKEN_FORMATTED_LENGTH !== 129 ||
        MAX_MESSAGE_BYTES !== 43) {
      throw new Error('Time Encrypt 协议长度不变量校验失败');
    }
  }

  function ensureCryptoSupport() {
    if (!globalThis.crypto?.subtle || typeof globalThis.crypto.getRandomValues !== 'function') {
      fail('UNSUPPORTED_BROWSER', '当前浏览器不支持所需的 Web Crypto API');
    }
  }

  function validateServerTime(nowSeconds) {
    if (!Number.isInteger(nowSeconds) || nowSeconds < 1 || nowSeconds > 0xffffffff) {
      fail('INVALID_SERVER_TIME', '尚未获得可信的服务器时间，请重新同步');
    }
  }

  function validateProtectedSecret(secret) {
    if (typeof secret !== 'string') fail('INVALID_SECRET', '请输入共享口令');
    const characters = [...secret].length;
    const bytes = encoder.encode(secret).length;
    if (characters < MIN_SECRET_CHARACTERS) {
      fail('SECRET_TOO_SHORT', `共享口令至少需要 ${MIN_SECRET_CHARACTERS} 个字符`);
    }
    if (bytes > MAX_SECRET_BYTES) {
      fail('SECRET_TOO_LONG', `共享口令不能超过 ${MAX_SECRET_BYTES} 个 UTF-8 字节`);
    }
  }

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

  function base62ToBytes(value, byteLength) {
    let number = 0n;
    for (const character of value) {
      const index = ALPHABET.indexOf(character);
      if (index < 0) fail('INVALID_TOKEN', '密文包含无效字符');
      number = number * 62n + BigInt(index);
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

  function inspectTokenInput(token) {
    const raw = cleanToken(token);
    return Object.freeze({
      rawLength: raw.length,
      formatted: formatToken(raw),
      complete: raw.length === TOKEN_RAW_LENGTH,
      validCharacters: raw.length === 0 || TOKEN_CHARACTERS.test(raw)
    });
  }

  function inspectTokenVersion(token) {
    const raw = cleanToken(token);
    if (raw.length !== TOKEN_RAW_LENGTH || !TOKEN_CHARACTERS.test(raw)) return null;
    try {
      return base62ToBytes(raw, PACKED_LENGTH)[0];
    } catch {
      return null;
    }
  }

  async function importHkdfMaterial(bytes) {
    return crypto.subtle.importKey('raw', bytes, 'HKDF', false, ['deriveKey']);
  }

  async function derivePasswordMaster(secret, iv, version) {
    const material = await crypto.subtle.importKey(
      'raw', encoder.encode(secret), 'PBKDF2', false, ['deriveBits']
    );
    const domain = version === LEGACY_PROTECTED_VERSION ? V3_PBKDF2_DOMAIN : V4_PBKDF2_DOMAIN;
    const bits = await crypto.subtle.deriveBits({
      name: 'PBKDF2',
      salt: concatBytes(encoder.encode(domain), iv),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    }, material, 256);
    return importHkdfMaterial(bits);
  }

  async function deriveMinuteKey(master, minute, version) {
    const info = version === LEGACY_PROTECTED_VERSION
      ? V3_HKDF_INFO
      : version === PROTECTED_VERSION ? V4_HKDF_INFO : V5_HKDF_INFO;
    return crypto.subtle.deriveKey({
      name: 'HKDF',
      hash: 'SHA-256',
      salt: uint32Bytes(minute),
      info: encoder.encode(info)
    }, master, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  function aesParameters(iv, version) {
    const context = version === LEGACY_PROTECTED_VERSION
      ? V3_AUTH_CONTEXT
      : version === PROTECTED_VERSION ? V4_AUTH_CONTEXT : V5_AUTH_CONTEXT;
    return {
      name: 'AES-GCM',
      iv,
      tagLength: AUTH_TAG_LENGTH * 8,
      additionalData: concatBytes(Uint8Array.of(version), encoder.encode(context))
    };
  }

  function createFrame(messageBytes, issuedAt) {
    const frame = new Uint8Array(FRAME_LENGTH);
    frame.set(uint32Bytes(issuedAt), 0);
    frame[4] = messageBytes.length;
    frame.set(messageBytes, FRAME_HEADER_LENGTH);
    crypto.getRandomValues(frame.subarray(FRAME_HEADER_LENGTH + messageBytes.length));
    return frame;
  }

  function decodeFrame(frame, candidateMinute, nowSeconds) {
    if (frame.length !== FRAME_LENGTH) fail('CORRUPT_TOKEN', '密文数据损坏');
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    const issuedAt = view.getUint32(0, false);
    const age = nowSeconds - issuedAt;
    if (Math.floor(issuedAt / 60) !== candidateMinute) {
      fail('CORRUPT_TOKEN', '密文时间与密钥窗口不一致');
    }
    if (age < -MAX_CLOCK_SKEW_SECONDS) fail('INVALID_TIME', '密文签发时间异常');
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

  async function encryptMessage(secret, message, nowSeconds) {
    ensureCryptoSupport();
    validateServerTime(nowSeconds);
    const protectedMode = typeof secret === 'string' && secret.length > 0;
    if (protectedMode) validateProtectedSecret(secret);
    const data = encoder.encode(String(message ?? ''));
    if (!data.length) fail('EMPTY_MESSAGE', '请输入要处理的内容');
    if (data.length > MAX_MESSAGE_BYTES) {
      fail('MESSAGE_TOO_LONG', `内容不能超过 ${MAX_MESSAGE_BYTES} 个 UTF-8 字节`);
    }

    const version = protectedMode ? PROTECTED_VERSION : CONVENIENCE_VERSION;
    const minute = Math.floor(nowSeconds / 60);
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const master = protectedMode
      ? await derivePasswordMaster(secret, iv, version)
      : await importHkdfMaterial(concatBytes(encoder.encode(V5_AUTH_CONTEXT), iv));
    const key = await deriveMinuteKey(master, minute, version);
    const encrypted = new Uint8Array(await crypto.subtle.encrypt(
      aesParameters(iv, version), key, createFrame(data, nowSeconds)
    ));
    const packed = concatBytes(Uint8Array.of(version), iv, encrypted);
    return {
      token: formatToken(bytesToBase62(packed)),
      issuedAt: nowSeconds,
      version,
      mode: protectedMode ? 'protected' : 'convenience'
    };
  }

  async function decryptMessage(secret, formattedToken, nowSeconds) {
    ensureCryptoSupport();
    validateServerTime(nowSeconds);
    const raw = cleanToken(formattedToken);
    if (raw.length !== TOKEN_RAW_LENGTH) {
      fail('INVALID_TOKEN_LENGTH', `密文应为 ${TOKEN_GROUP_COUNT} 组 × ${TOKEN_GROUP_SIZE} 位`);
    }
    if (!TOKEN_CHARACTERS.test(raw)) fail('INVALID_TOKEN', '密文只能包含大小写字母和数字');
    const packed = base62ToBytes(raw, PACKED_LENGTH);
    const version = packed[0];
    const supported = [LEGACY_PROTECTED_VERSION, PROTECTED_VERSION, CONVENIENCE_VERSION];
    if (!supported.includes(version)) fail('UNSUPPORTED_VERSION', '不支持此密文版本');

    const protectedMode = version !== CONVENIENCE_VERSION;
    if (protectedMode) validateProtectedSecret(secret);
    const iv = packed.slice(VERSION_LENGTH, VERSION_LENGTH + IV_LENGTH);
    const encrypted = packed.slice(VERSION_LENGTH + IV_LENGTH);
    const master = protectedMode
      ? await derivePasswordMaster(secret, iv, version)
      : await importHkdfMaterial(concatBytes(encoder.encode(V5_AUTH_CONTEXT), iv));
    const currentMinute = Math.floor(nowSeconds / 60);

    for (let candidate = currentMinute + MAX_FUTURE_MINUTE_OFFSET;
         candidate >= currentMinute - MAX_PAST_MINUTE_OFFSET; candidate -= 1) {
      try {
        const key = await deriveMinuteKey(master, candidate, version);
        const frame = new Uint8Array(await crypto.subtle.decrypt(
          aesParameters(iv, version), key, encrypted
        ));
        return {
          ...decodeFrame(frame, candidate, nowSeconds),
          version,
          mode: protectedMode ? 'protected' : 'convenience'
        };
      } catch (error) {
        if (error instanceof TimeCryptoError) throw error;
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
    PROTOCOL_VERSION: PROTECTED_VERSION,
    PROTECTED_VERSION,
    CONVENIENCE_VERSION,
    LEGACY_PROTECTED_VERSION,
    TOKEN_RAW_LENGTH,
    TOKEN_GROUP_COUNT,
    TOKEN_GROUP_SIZE,
    TOKEN_FORMATTED_LENGTH,
    inspectTokenInput,
    inspectTokenVersion,
    encryptMessage,
    decryptMessage
  });
})();

