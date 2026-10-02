/**
 * Encryption of the offline outbox at rest (ADR-0013): AES-GCM with a key that exists for the browser session only
 * (sessionStorage: it survives a reload of the tab and dies with it), so closing the tab discards what was not yet
 * replayed, by design. No key ever leaves the browser or reaches the API.
 */
const KEY_SLOT = "healthcare-offline-key";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToBytes(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** The session's key: created on first use, kept in sessionStorage. Null when the browser has no session storage. */
export async function sessionKey(
  storage: Pick<Storage, "getItem" | "setItem"> | null = typeof sessionStorage === "undefined" ? null : sessionStorage,
): Promise<CryptoKey | null> {
  if (!storage) return null;
  let raw = storage.getItem(KEY_SLOT);
  if (!raw) {
    raw = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
    storage.setItem(KEY_SLOT, raw);
  }
  return crypto.subtle.importKey("raw", base64ToBytes(raw), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** Encrypts a JSON value; the result is `iv.ciphertext` in base64. */
export async function seal(key: CryptoKey, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(value));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data));
  return `${bytesToBase64(iv)}.${bytesToBase64(cipher)}`;
}

/** Decrypts what `seal` produced; null when the key does not fit (another session's data) or the text is damaged. */
export async function open<T>(key: CryptoKey, sealed: string): Promise<T | null> {
  const [iv, cipher] = sealed.split(".");
  if (!iv || !cipher) return null;
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(iv) }, key, base64ToBytes(cipher));
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    return null;
  }
}
