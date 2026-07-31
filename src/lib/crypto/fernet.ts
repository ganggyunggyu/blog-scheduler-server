import { createDecipheriv, createHash, createHmac, timingSafeEqual } from 'node:crypto';

/*
  dabut-backend 가 네이버 계정 비밀번호를 Fernet 으로 암호화해서 넣는다(utils/api_keys.py).
  발행 워커는 평문 비밀번호가 필요한데 dabut API 는 has_password 불리언만 내보내므로,
  같은 규칙으로 여기서 직접 복호화한다.

  키 파생은 dabut 과 동일하다: Fernet key = base64url(sha256(API_KEY_ENC_SECRET))
    signing key    = sha256 digest[0..16]
    encryption key = sha256 digest[16..32]
*/

const ENC_PREFIX = 'enc:v1:';
const VERSION = 0x80;
const HMAC_LENGTH = 32;
const IV_OFFSET = 9;
const CIPHERTEXT_OFFSET = 25;

const base64UrlDecode = (value: string): Buffer =>
  Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

const deriveKeys = (secret: string): { signingKey: Buffer; encryptionKey: Buffer } => {
  const digest = createHash('sha256').update(secret, 'utf-8').digest();
  return {
    signingKey: digest.subarray(0, 16),
    encryptionKey: digest.subarray(16, 32),
  };
};

/** Fernet 토큰 하나를 평문으로 되돌린다. 서명이 안 맞거나 형식이 깨졌으면 null. */
export const decryptFernet = (token: string, secret: string): string | null => {
  if (!token || !secret) return null;

  try {
    const raw = base64UrlDecode(token);
    if (raw.length < CIPHERTEXT_OFFSET + HMAC_LENGTH) return null;
    if (raw[0] !== VERSION) return null;

    const body = raw.subarray(0, raw.length - HMAC_LENGTH);
    const signature = raw.subarray(raw.length - HMAC_LENGTH);

    const { signingKey, encryptionKey } = deriveKeys(secret);

    const expected = createHmac('sha256', signingKey).update(body).digest();
    if (expected.length !== signature.length) return null;
    if (!timingSafeEqual(expected, signature)) return null;

    const iv = raw.subarray(IV_OFFSET, CIPHERTEXT_OFFSET);
    const ciphertext = body.subarray(CIPHERTEXT_OFFSET);
    if (ciphertext.length === 0 || ciphertext.length % 16 !== 0) return null;

    const decipher = createDecipheriv('aes-128-cbc', encryptionKey, iv);
    decipher.setAutoPadding(true);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    return plain.toString('utf-8');
  } catch {
    return null;
  }
};

/** dabut 이 저장한 `enc:v1:` 접두 값을 복호화한다. */
export const decryptStoredSecret = (stored: string, secret: string): string | null => {
  if (!stored?.startsWith(ENC_PREFIX)) return null;
  return decryptFernet(stored.slice(ENC_PREFIX.length), secret);
};
