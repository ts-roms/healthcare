import { createHash, createSign, generateKeyPairSync, type KeyObject, randomBytes } from "node:crypto";
import { authenticator } from "otplib";
import { isoBase64URL, isoCBOR } from "@simplewebauthn/server/helpers";
import { as, auditRows, createStaff, createTenant, createTestApp, juan, login, type Tenant, type TestContext } from "./harness";

const PASSWORD = "Pahintulot-ko-2026";
const ORG = "myhealth-passkeys";
const EMAIL = "juan@passkeys.ph";
const PORTAL = "https://myhealth.test.invalid";
const RP_ID = "myhealth.test.invalid";

const b64 = (bytes: Uint8Array | Buffer) => isoBase64URL.fromBuffer(new Uint8Array(bytes));
const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest();
const counterBytes = (n: number) => {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(n);
  return out;
};

/**
 * A software passkey (ES256, "none" attestation), standing in for a phone in these tests: it makes the same
 * registration and assertion answers a browser would, with user presence and verification set unless told otherwise.
 */
class SoftAuthenticator {
  readonly credentialId = randomBytes(32);
  private readonly privateKey: KeyObject;
  private readonly cose: Uint8Array;
  counter = 0;

  constructor(private readonly origin = PORTAL) {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.privateKey = privateKey;
    const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
    this.cose = isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, isoBase64URL.toBuffer(jwk.x)],
        [-3, isoBase64URL.toBuffer(jwk.y)],
      ]),
    );
  }

  get id(): string {
    return b64(this.credentialId);
  }

  register(options: { challenge: string; rp: { id?: string } }) {
    const clientData = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin: this.origin, crossOrigin: false }));
    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(this.credentialId.length);
    const authData = Buffer.concat([
      sha256(options.rp.id ?? RP_ID),
      Buffer.from([0x45]), // user present, user verified, attested credential data
      counterBytes(this.counter),
      Buffer.alloc(16),
      idLength,
      this.credentialId,
      Buffer.from(this.cose),
    ]);
    const attestationObject = isoCBOR.encode(
      new Map<string, string | Map<string, never> | Uint8Array>([
        ["fmt", "none"],
        ["attStmt", new Map<string, never>()],
        ["authData", new Uint8Array(authData)],
      ]),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: { clientDataJSON: b64(clientData), attestationObject: b64(attestationObject), transports: ["internal"] },
      clientExtensionResults: {},
    };
  }

  assert(challenge: string, { counter = this.counter + 1, flags = 0x05 }: { counter?: number; flags?: number } = {}) {
    this.counter = counter;
    const clientData = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge, origin: this.origin, crossOrigin: false }));
    const authData = Buffer.concat([sha256(RP_ID), Buffer.from([flags]), counterBytes(counter)]);
    const signature = createSign("sha256")
      .update(Buffer.concat([authData, sha256(clientData)]))
      .sign(this.privateKey);
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: { clientDataJSON: b64(clientData), authenticatorData: b64(authData), signature: b64(signature) },
      clientExtensionResults: {},
    };
  }
}

/**
 * Passkeys for MyHealth (docs/architecture/portal-app.md, "Passkeys"; migration 0108): added on top of two-step
 * verification with the app after the password and a current code; they answer the second step of signing in;
 * challenges work once; a counter that goes backwards is refused and audited; failures count toward the lockout;
 * turning two-step verification off or the clinic resetting it removes them.
 */
describe("MyHealth passkeys", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let patientId: string;
  let session: string;
  let secret = "";
  let recoveryCodes: string[] = [];
  const phone = new SoftAuthenticator();

  const portalPost = (path: string, body: object = {}, token?: string) => {
    const req = ctx.http().post(`/api/v1/portal${path}`);
    return (token ? req.set("Authorization", `Bearer ${token}`) : req).send(body);
  };
  const portalGet = (path: string, token: string) => ctx.http().get(`/api/v1/portal${path}`).set("Authorization", `Bearer ${token}`);
  const signIn = () => portalPost("/auth/login", { organizationCode: ORG, email: EMAIL, password: PASSWORD });
  const freshCode = async () => {
    await ctx.pool.query("UPDATE patient_portal_account SET mfa_last_used_step = 0 WHERE patient_id = $1 AND mfa_enabled", [patientId]);
    return authenticator.generate(secret);
  };
  const enableMfa = async () => {
    secret = (await portalPost("/mfa/setup", { password: PASSWORD }, session).expect(200)).body.secret;
    recoveryCodes = (await portalPost("/mfa/enable", { code: authenticator.generate(secret) }, session).expect(200)).body.recoveryCodes;
  };
  const addPasskey = async (device: SoftAuthenticator, label?: string) => {
    const options = (await portalPost("/mfa/passkeys/options", { password: PASSWORD, code: await freshCode() }, session).expect(200)).body;
    return portalPost("/mfa/passkeys", { response: device.register(options), ...(label ? { label } : {}) }, session).expect(201);
  };
  /** The password step, then the passkey options for its challenge. */
  const passkeyChallenge = async () => {
    const challenge = (await signIn().expect(200)).body as { status: string; challengeToken: string; passkeys: boolean };
    const options = (await portalPost("/auth/mfa/passkey/options", { challengeToken: challenge.challengeToken }).expect(200)).body;
    return { challengeToken: challenge.challengeToken, options, passkeys: challenge.passkeys };
  };
  const audits = (action: string) => auditRows(ctx.pool, "action = $1", [action]);
  const failedAttempts = async () =>
    (await ctx.pool.query<{ failed_attempts: number }>("SELECT failed_attempts FROM patient_portal_account WHERE patient_id = $1", [patientId])).rows[0]!
      .failed_attempts;
  const securityAlerts = async () =>
    (
      await ctx.pool.query<{ variables: Record<string, string> }>(
        "SELECT variables FROM notification WHERE recipient_patient_id = $1 AND template_key = 'portal.security-alert' ORDER BY created_at",
        [patientId],
      )
    ).rows.map((r) => r.variables["event"]);

  beforeAll(async () => {
    ctx = await createTestApp({}, { PORTAL_BASE_URL: PORTAL });
    tenant = await createTenant(ctx.pool, ORG);
    await createStaff(ctx.pool, tenant, "admin@passkeys.ph", ["org_admin"]);
    admin = (await login(ctx, "admin@passkeys.ph")).accessToken;
    const staffPost = (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(admin, tenant.facilityId)).send(body);
    patientId = (await staffPost("/patients", juan).expect(201)).body.id;
    await staffPost(`/patients/${patientId}/consents`, { consentType: "portal_access", decision: "granted", capturedVia: "paper" }).expect(201);
    const code = (await staffPost(`/patients/${patientId}/portal-account/invitations`).expect(201)).body.activationCode;
    const { rows } = await ctx.pool.query<{ patient_number: string; birth_date: string }>(
      "SELECT patient_number, to_char(birth_date, 'YYYY-MM-DD') AS birth_date FROM patient WHERE id = $1",
      [patientId],
    );
    session = (
      await portalPost("/auth/activate", {
        organizationCode: ORG,
        patientNumber: rows[0]!.patient_number,
        birthDate: rows[0]!.birth_date,
        activationCode: code,
        email: EMAIL,
        password: PASSWORD,
      }).expect(200)
    ).body.accessToken;
    // The email proof itself is covered in portal-security.int.spec.ts.
    await ctx.pool.query("UPDATE patient_portal_account SET email_verified_at = now() WHERE patient_id = $1", [patientId]);
  });
  afterAll(async () => {
    await ctx.close();
  });

  it("needs two-step verification with the app first", async () => {
    expect((await portalGet("/mfa/passkeys", session).expect(200)).body).toEqual({ available: true, limit: 5, passkeys: [] });
    await portalPost("/mfa/passkeys/options", { password: PASSWORD, code: "123456" }, session)
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("mfa_not_enabled"));
    await enableMfa();
  });

  it("adds a passkey after the password and a current code, storing only its public key", async () => {
    await portalPost("/mfa/passkeys/options", { password: "wrong-password-123", code: await freshCode() }, session)
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("invalid_credentials"));
    await portalPost("/mfa/passkeys/options", { password: PASSWORD, code: "000000" }, session)
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("invalid_mfa_code"));
    await ctx.pool.query("UPDATE patient_portal_account SET failed_attempts = 0 WHERE patient_id = $1", [patientId]);

    const options = (await portalPost("/mfa/passkeys/options", { password: PASSWORD, code: await freshCode() }, session).expect(200)).body;
    expect(options).toMatchObject({ rp: { id: RP_ID }, attestation: "none", authenticatorSelection: { userVerification: "required" } });
    const { rows: challenges } = await ctx.pool.query<{ challenge_hash: string }>("SELECT challenge_hash FROM patient_passkey_challenge");
    expect(challenges.map((c) => c.challenge_hash)).toEqual([createHash("sha256").update(options.challenge).digest("hex")]);

    const added = (await portalPost("/mfa/passkeys", { response: phone.register(options), label: "My phone" }, session).expect(201)).body;
    expect(added).toMatchObject({ label: "My phone", backedUp: false, lastUsedAt: null });
    // The same options cannot add a second passkey: the challenge was spent.
    await portalPost("/mfa/passkeys", { response: new SoftAuthenticator().register(options) }, session)
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("passkey_challenge_invalid"));

    const { rows } = await ctx.pool.query<{ credential_id: string; public_key: string; label: string }>(
      "SELECT credential_id, public_key, label FROM patient_passkey WHERE revoked_at IS NULL",
    );
    expect(rows).toEqual([{ credential_id: phone.id, public_key: expect.stringMatching(/^[A-Za-z0-9_-]+$/), label: "My phone" }]);
    expect(await audits("portal.passkey-add")).toHaveLength(1);
    expect(await securityAlerts()).toContain("passkey_added");
    expect((await portalGet("/mfa/passkeys", session).expect(200)).body.passkeys).toHaveLength(1);
  });

  it("refuses a passkey made for another address", async () => {
    const options = (await portalPost("/mfa/passkeys/options", { password: PASSWORD, code: await freshCode() }, session).expect(200)).body;
    await portalPost("/mfa/passkeys", { response: new SoftAuthenticator("https://phishing.test.invalid").register(options) }, session)
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("passkey_not_verified"));
  });

  it("signs in with the passkey instead of a code, and can remember the browser", async () => {
    const { challengeToken, options, passkeys } = await passkeyChallenge();
    expect(passkeys).toBe(true);
    expect(options).toMatchObject({ rpId: RP_ID, userVerification: "required", allowCredentials: [{ id: phone.id }] });
    const tokens = (await portalPost("/auth/mfa/verify", { challengeToken, passkey: phone.assert(options.challenge), rememberDevice: true }).expect(200)).body;
    expect(tokens).toMatchObject({ accessToken: expect.any(String), deviceToken: expect.any(String) });
    const [loginAudit] = (await audits("portal.login")).slice(-1);
    expect(loginAudit!.metadata).toMatchObject({ method: "password+passkey" });
    const { rows } = await ctx.pool.query<{ sign_count: string; last_used_at: Date | null }>("SELECT sign_count, last_used_at FROM patient_passkey");
    expect(rows[0]).toMatchObject({ sign_count: String(phone.counter), last_used_at: expect.any(Date) });
    // A code still works, and is the only answer when the request names neither or both.
    await portalPost("/auth/mfa/verify", { challengeToken }).expect(400);
  });

  it("spends each challenge once, and refuses another account's or an unknown passkey", async () => {
    const { challengeToken, options } = await passkeyChallenge();
    const answer = phone.assert(options.challenge);
    await portalPost("/auth/mfa/verify", { challengeToken, passkey: answer }).expect(200);
    await portalPost("/auth/mfa/verify", { challengeToken, passkey: answer })
      .expect(401)
      .expect((r) => expect(r.body.error.code).toBe("invalid_passkey"));

    const next = await passkeyChallenge();
    await portalPost("/auth/mfa/verify", { challengeToken: next.challengeToken, passkey: new SoftAuthenticator().assert(next.options.challenge) })
      .expect(401)
      .expect((r) => expect(r.body.error.code).toBe("invalid_passkey"));
    // Without user verification (no PIN, fingerprint or face) the answer does not count.
    const third = await passkeyChallenge();
    await portalPost("/auth/mfa/verify", { challengeToken: third.challengeToken, passkey: phone.assert(third.options.challenge, { flags: 0x01 }) }).expect(401);
    expect(await failedAttempts()).toBe(3);
    await ctx.pool.query("UPDATE patient_portal_account SET failed_attempts = 0 WHERE patient_id = $1", [patientId]);
  });

  it("refuses and audits a counter that went backwards (a possible copy)", async () => {
    const { challengeToken, options } = await passkeyChallenge();
    await portalPost("/auth/mfa/verify", { challengeToken, passkey: phone.assert(options.challenge, { counter: 1 }) })
      .expect(401)
      .expect((r) => expect(r.body.error.code).toBe("invalid_passkey"));
    const [refused] = await audits("portal.passkey-refused");
    expect(refused).toMatchObject({ outcome: "denied", reason: "counter_rollback" });
    expect(await failedAttempts()).toBe(1);
  });

  it("counts failed passkey answers toward the lockout", async () => {
    for (let i = 0; i < 5; i += 1) {
      const { challengeToken, options } = await passkeyChallenge().catch(() => ({ challengeToken: "", options: { challenge: "" } }));
      if (!challengeToken) break;
      await portalPost("/auth/mfa/verify", { challengeToken, passkey: new SoftAuthenticator().assert(options.challenge) });
    }
    await signIn()
      .expect(401)
      .expect((r) => expect(r.body.error.code).toBe("account_locked"));
    await ctx.pool.query("UPDATE patient_portal_account SET failed_attempts = 0, locked_until = NULL WHERE patient_id = $1", [patientId]);
  });

  it("allows at most five passkeys and lets the patient remove one", async () => {
    for (let i = 0; i < 4; i += 1) await addPasskey(new SoftAuthenticator());
    await portalPost("/mfa/passkeys/options", { password: PASSWORD, code: await freshCode() }, session)
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("passkey_limit_reached"));
    const list = (await portalGet("/mfa/passkeys", session).expect(200)).body.passkeys as Array<{ id: string; label: string }>;
    expect(list).toHaveLength(5);
    await portalPost(`/mfa/passkeys/${list[4]!.id}/remove`, {}, session).expect(204);
    await portalPost(`/mfa/passkeys/${list[4]!.id}/remove`, {}, session).expect(404);
    expect(await audits("portal.passkey-remove")).toHaveLength(1);
    expect(await securityAlerts()).toContain("passkey_removed");
  });

  it("removes every passkey when two-step verification is turned off, and when the clinic resets it", async () => {
    await portalPost("/mfa/disable", { password: PASSWORD, code: recoveryCodes[0]! }, session).expect(204);
    const reasons = async () =>
      (await ctx.pool.query<{ revoked_reason: string | null }>("SELECT revoked_reason FROM patient_passkey ORDER BY created_at")).rows.map(
        (r) => r.revoked_reason,
      );
    expect(await reasons()).toEqual(["mfa_disabled", "mfa_disabled", "mfa_disabled", "mfa_disabled", "removed_by_patient"]);
    expect((await signIn().expect(200)).body).toMatchObject({ accessToken: expect.any(String) });

    await enableMfa();
    await addPasskey(new SoftAuthenticator());
    expect((await signIn().expect(200)).body).toMatchObject({ status: "mfa_required", passkeys: true });
    await ctx
      .http()
      .post(`/api/v1/patients/${patientId}/portal-account/mfa-reset`)
      .set(as(admin, tenant.facilityId))
      .send({ reason: "Lost phone; identity checked at the front desk" })
      .expect(204);
    expect((await reasons()).at(-1)).toBe("mfa_reset");
  });

  it("answers passkeys_unavailable without MyHealth's address", async () => {
    const saved = ctx.config.PORTAL_BASE_URL;
    (ctx.config as { PORTAL_BASE_URL?: string }).PORTAL_BASE_URL = undefined;
    try {
      session = (await signIn().expect(200)).body.accessToken;
      expect((await portalGet("/mfa/passkeys", session).expect(200)).body.available).toBe(false);
      await enableMfa();
      await portalPost("/mfa/passkeys/options", { password: PASSWORD, code: await freshCode() }, session)
        .expect(422)
        .expect((r) => expect(r.body.error.code).toBe("passkeys_unavailable"));
    } finally {
      (ctx.config as { PORTAL_BASE_URL?: string }).PORTAL_BASE_URL = saved;
    }
  });
});
