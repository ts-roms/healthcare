import { randomBytes } from "node:crypto";
import { integrationPayloadKeyring, loadAppConfig } from "./app-config";

const key = () => randomBytes(32).toString("base64");
const mfa = key();
const base = { DATABASE_URL: "postgres://u:p@localhost:5432/db", JWT_ACCESS_SECRET: "x".repeat(32), MFA_ENCRYPTION_KEY: mfa };

describe("integration payload keys", () => {
  it("falls back to MFA_ENCRYPTION_KEY outside production only", () => {
    const ring = integrationPayloadKeyring(loadAppConfig({ ...base, NODE_ENV: "development" }));
    expect(ring.currentKeyId).toBe("development");
    expect(ring.keys.get("development")).toBe(mfa);
    expect(() => loadAppConfig({ ...base, NODE_ENV: "production" })).toThrow("INTEGRATION_PAYLOAD_KEY (or INTEGRATION_PAYLOAD_KEYS) is required in production");
  });

  it("keeps INTEGRATION_PAYLOAD_KEY working as the key with id 'default'", () => {
    const single = key();
    const ring = integrationPayloadKeyring(loadAppConfig({ ...base, NODE_ENV: "production", INTEGRATION_PAYLOAD_KEY: single }));
    expect(ring).toEqual({ currentKeyId: "default", keys: new Map([["default", single]]) });
  });

  it("reads a key ring and seals with the named current key", () => {
    const [a, b, legacy] = [key(), key(), key()];
    const ring = integrationPayloadKeyring(
      loadAppConfig({
        ...base,
        NODE_ENV: "production",
        INTEGRATION_PAYLOAD_KEY: legacy,
        INTEGRATION_PAYLOAD_KEYS: JSON.stringify({ "2026-a": a, "2026-b": b }),
        INTEGRATION_PAYLOAD_KEY_ID: "2026-b",
      }),
    );
    expect(ring.currentKeyId).toBe("2026-b");
    expect([...ring.keys.keys()].sort()).toEqual(["2026-a", "2026-b", "default"]);
    // One listed key needs no id.
    expect(integrationPayloadKeyring(loadAppConfig({ ...base, INTEGRATION_PAYLOAD_KEYS: JSON.stringify({ only: a }) })).currentKeyId).toBe("only");
  });

  it("refuses ambiguous or invalid key rings", () => {
    const load = (env: Record<string, string>) => () => loadAppConfig({ ...base, ...env });
    const two = JSON.stringify({ a: key(), b: key() });
    expect(load({ INTEGRATION_PAYLOAD_KEYS: two })).toThrow("INTEGRATION_PAYLOAD_KEY_ID: is required when several integration payload keys are configured");
    expect(load({ INTEGRATION_PAYLOAD_KEYS: two, INTEGRATION_PAYLOAD_KEY_ID: "c" })).toThrow('"c" is not a configured integration payload key id');
    expect(load({ INTEGRATION_PAYLOAD_KEY: key(), INTEGRATION_PAYLOAD_KEYS: JSON.stringify({ a: key() }) })).toThrow("INTEGRATION_PAYLOAD_KEY_ID");
    expect(load({ INTEGRATION_PAYLOAD_KEYS: JSON.stringify({ "bad.id": key() }) })).toThrow("key ids are 1–40 letters");
    expect(load({ INTEGRATION_PAYLOAD_KEYS: JSON.stringify({ a: "c2hvcnQ=" }) })).toThrow("each key must be 32 bytes");
    expect(load({ INTEGRATION_PAYLOAD_KEYS: "not json" })).toThrow("must be a JSON object");
    expect(load({ INTEGRATION_PAYLOAD_KEYS: "{}" })).toThrow("list at least one key");
    expect(load({ INTEGRATION_PAYLOAD_KEY: key(), INTEGRATION_PAYLOAD_KEYS: JSON.stringify({ default: key() }) })).toThrow('key id "default"');
    expect(load({ INTEGRATION_PAYLOAD_KEY_ID: "a" })).toThrow("no integration payload key is configured");
  });

  it("keeps production's key separate from MFA_ENCRYPTION_KEY", () => {
    expect(() => loadAppConfig({ ...base, NODE_ENV: "production", INTEGRATION_PAYLOAD_KEYS: JSON.stringify({ a: mfa }) })).toThrow(
      'key "a" is MFA_ENCRYPTION_KEY; use a separate key in production',
    );
  });
});
