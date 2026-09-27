import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

/** URL-safe random token with the given entropy in bytes. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const FORMAT_VERSION = 'v1';

/**
 * Authenticated encryption for small secrets stored in the database
 * (e.g. TOTP seeds). Output: "v1.<iv>.<tag>.<ciphertext>" in base64url.
 */
export function encryptSecret(plaintext: string, base64Key: string): string {
  const key = decodeKey(base64Key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [FORMAT_VERSION, iv, cipher.getAuthTag(), ciphertext]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}

export function decryptSecret(payload: string, base64Key: string): string {
  const [version, iv, tag, ciphertext] = payload.split('.');
  if (version !== FORMAT_VERSION || !iv || !tag || !ciphertext) {
    throw new Error('Unsupported encrypted secret format');
  }
  const decipher = createDecipheriv(ALGORITHM, decodeKey(base64Key), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}

function decodeKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) throw new Error('Encryption key must be 32 bytes');
  return key;
}
