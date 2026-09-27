import { randomBytes } from "node:crypto";
import {
  decryptSecret,
  EncryptionKeyUnavailableError,
  encryptSecret,
  type Keyring,
  openWithKeyring,
  randomToken,
  sealedKeyId,
  sealWithKeyring,
  sha256Hex,
} from "./crypto";

const key = randomBytes(32).toString("base64");

describe("encryptSecret / decryptSecret", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = encryptSecret("JBSWY3DPEHPK3PXP", key);
    const b = encryptSecret("JBSWY3DPEHPK3PXP", key);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, key)).toBe("JBSWY3DPEHPK3PXP");
  });

  it("rejects tampered ciphertext", () => {
    const payload = encryptSecret("secret", key);
    const parts = payload.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join("."), key)).toThrow();
  });

  it("rejects the wrong key", () => {
    const payload = encryptSecret("secret", key);
    expect(() => decryptSecret(payload, randomBytes(32).toString("base64"))).toThrow();
  });
});

describe("helpers", () => {
  it("produces url-safe tokens and stable hashes", () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("key rings (sealWithKeyring / openWithKeyring)", () => {
  const oldKey = randomBytes(32).toString("base64");
  const newKey = randomBytes(32).toString("base64");
  const before: Keyring = { currentKeyId: "2026-a", keys: new Map([["2026-a", oldKey]]) };
  // Rotation: the new key is current, the old one is still listed for values sealed with it.
  const during: Keyring = {
    currentKeyId: "2026-b",
    keys: new Map([
      ["2026-a", oldKey],
      ["2026-b", newKey],
    ]),
  };
  const after: Keyring = { currentKeyId: "2026-b", keys: new Map([["2026-b", newKey]]) };

  it("seals with the current key and tags the value with its id", () => {
    const { keyId, sealed } = sealWithKeyring('{"claim":1}', during);
    expect(keyId).toBe("2026-b");
    expect(sealed.startsWith("v2.2026-b.")).toBe(true);
    expect(sealedKeyId(sealed)).toBe("2026-b");
    expect(openWithKeyring(sealed, during)).toBe('{"claim":1}');
    expect(openWithKeyring(sealed, after)).toBe('{"claim":1}');
  });

  it("opens values sealed with an earlier key while that key is still listed", () => {
    const { sealed } = sealWithKeyring("queued before the rotation", before);
    expect(openWithKeyring(sealed, during)).toBe("queued before the rotation");
  });

  it("names the missing key when it has been removed", () => {
    const { sealed } = sealWithKeyring("queued before the rotation", before);
    expect(() => openWithKeyring(sealed, after)).toThrow(EncryptionKeyUnavailableError);
    expect(() => openWithKeyring(sealed, after)).toThrow('sealed with key "2026-a", which is not configured');
  });

  it("authenticates the key id: a value relabelled with another id does not open", () => {
    const sameKeyTwice: Keyring = {
      currentKeyId: "x",
      keys: new Map([
        ["x", oldKey],
        ["y", oldKey],
      ]),
    };
    const { sealed } = sealWithKeyring("secret", sameKeyTwice);
    expect(() => openWithKeyring(sealed.replace("v2.x.", "v2.y."), sameKeyTwice)).toThrow();
  });

  it("opens v1 values (sealed before key ids) with whichever listed key fits", () => {
    const legacy = encryptSecret("legacy payload", oldKey);
    expect(sealedKeyId(legacy)).toBeNull();
    expect(openWithKeyring(legacy, during)).toBe("legacy payload");
    expect(() => openWithKeyring(legacy, after)).toThrow("no configured key opens it");
  });

  it("rejects tampering and unknown formats", () => {
    const { sealed } = sealWithKeyring("secret", during);
    const parts = sealed.split(".");
    parts[4] = Buffer.from("tampered").toString("base64url");
    expect(() => openWithKeyring(parts.join("."), during)).toThrow();
    expect(() => openWithKeyring(`v9.${sealed.slice(3)}`, during)).toThrow("Unsupported encrypted secret format");
    expect(() => decryptSecret(sealed, newKey)).toThrow("Unsupported encrypted secret format");
    expect(() => sealWithKeyring("x", { currentKeyId: "gone", keys: new Map() })).toThrow(EncryptionKeyUnavailableError);
  });
});
