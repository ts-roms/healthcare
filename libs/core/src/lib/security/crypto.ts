import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

/** URL-safe random token with the given entropy in bytes. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const FORMAT_VERSION = "v1";

/**
 * Authenticated encryption for small secrets stored in the database
 * (e.g. TOTP seeds). Output: "v1.<iv>.<tag>.<ciphertext>" in base64url.
 */
export function encryptSecret(plaintext: string, base64Key: string): string {
  return [FORMAT_VERSION, ...seal(plaintext, decodeKey(base64Key))].join(".");
}

export function decryptSecret(payload: string, base64Key: string): string {
  const [version, iv, tag, ciphertext, extra] = payload.split(".");
  if (version !== FORMAT_VERSION || !iv || !tag || !ciphertext || extra !== undefined) {
    throw new Error("Unsupported encrypted secret format");
  }
  return open(iv, tag, ciphertext, decodeKey(base64Key));
}

// ---- Key rings: encryption keys with ids, so a key can be rotated while data sealed with the old one is still read ----

const KEYED_FORMAT_VERSION = "v2";

/** Key ids appear in sealed values and configuration: letters, digits, "_" and "-" (no dots). */
export const ENCRYPTION_KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

/** Base64 AES-256 keys by id, and the id new values are sealed with. */
export interface Keyring {
  currentKeyId: string;
  keys: ReadonlyMap<string, string>;
}

/** The value names a key the key ring does not hold (e.g. it was removed before everything sealed with it was read). */
export class EncryptionKeyUnavailableError extends Error {
  constructor(readonly keyId: string) {
    super(`sealed with key "${keyId}", which is not configured`);
    this.name = "EncryptionKeyUnavailableError";
  }
}

/**
 * Seals with the key ring's current key: "v2.<keyId>.<iv>.<tag>.<ciphertext>" (base64url). The "v2.<keyId>" header
 * is authenticated (additional data), so a value cannot be relabelled with another key id.
 */
export function sealWithKeyring(plaintext: string, keyring: Keyring): { keyId: string; sealed: string } {
  const keyId = keyring.currentKeyId;
  const key = keyring.keys.get(keyId);
  if (!key) throw new EncryptionKeyUnavailableError(keyId);
  const header = `${KEYED_FORMAT_VERSION}.${keyId}`;
  return { keyId, sealed: [header, ...seal(plaintext, decodeKey(key), header)].join(".") };
}

/** The key id of a sealed value; null for a "v1" value (sealed before key ids existed). */
export function sealedKeyId(sealed: string): string | null {
  const [version, keyId] = sealed.split(".");
  if (version === FORMAT_VERSION) return null;
  if (version === KEYED_FORMAT_VERSION && keyId && ENCRYPTION_KEY_ID_PATTERN.test(keyId)) return keyId;
  throw new Error("Unsupported encrypted secret format");
}

/**
 * Opens a value sealed with any key in the ring. A "v2" value names its key: a missing key throws
 * EncryptionKeyUnavailableError. A "v1" value (no key id) is tried against every key — the GCM tag rejects the wrong ones.
 */
export function openWithKeyring(sealed: string, keyring: Keyring): string {
  const keyId = sealedKeyId(sealed);
  if (keyId === null) {
    for (const key of keyring.keys.values()) {
      try {
        return decryptSecret(sealed, key);
      } catch {
        // Not this key.
      }
    }
    throw new Error("sealed before key ids existed and no configured key opens it");
  }
  const key = keyring.keys.get(keyId);
  if (!key) throw new EncryptionKeyUnavailableError(keyId);
  const [, , iv, tag, ciphertext, extra] = sealed.split(".");
  if (!iv || !tag || !ciphertext || extra !== undefined) throw new Error("Unsupported encrypted secret format");
  return open(iv, tag, ciphertext, decodeKey(key), `${KEYED_FORMAT_VERSION}.${keyId}`);
}

function seal(plaintext: string, key: Buffer, additionalData?: string): string[] {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  if (additionalData) cipher.setAAD(Buffer.from(additionalData, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url"));
}

function open(iv: string, tag: string, ciphertext: string, key: Buffer, additionalData?: string): string {
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, "base64url"));
  if (additionalData) decipher.setAAD(Buffer.from(additionalData, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

export function decodeKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) throw new Error("Encryption key must be 32 bytes");
  return key;
}
