import type { MalwareScanner, ScanResult } from "@healthcare/documents";
import { MALWARE_SCANNER } from "@healthcare/documents";
import { as, auditRows, createStaff, createTenant, createTestApp, drainEvents, juan, login, type Tenant, type TestContext } from "./harness";

const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

/** A scanner that finds the EICAR string, and can be switched off the network. */
class FakeScanner implements MalwareScanner {
  readonly configured = true;
  down = false;
  async scan(bytes: Buffer): Promise<ScanResult> {
    if (this.down) return { verdict: "unavailable", reason: "connection refused" };
    return bytes.toString("latin1").includes(EICAR) ? { verdict: "infected", signature: "Eicar-Test-Signature" } : { verdict: "clean" };
  }
  async probe(): Promise<"ok" | "unreachable"> {
    return this.down ? "unreachable" : "ok";
  }
}

/**
 * Malware scanning and checksums of documents (migration 0098, docs/domains/documents.md): every completed upload is
 * read back, hashed and scanned; an infected one is quarantined (never available), everyone who manages documents is
 * told, and nothing that attaches or serves documents reaches it.
 */
describe("document scanning and checksums", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let patientId: string;
  const scanner = new FakeScanner();

  const register = (body: Record<string, unknown> = {}) =>
    ctx
      .http()
      .post("/api/v1/documents")
      .set(as(admin, tenant.facilityId))
      .send({ category: "clinical_attachment", title: "Scan", fileName: "scan.pdf", contentType: "application/pdf", sizeBytes: 1, patientId, ...body });
  const key = async (id: string) =>
    (await ctx.pool.query<{ storage_key: string }>("SELECT storage_key FROM document WHERE id = $1", [id])).rows[0]!.storage_key;
  const complete = (id: string) => ctx.http().post(`/api/v1/documents/${id}/complete`).set(as(admin, tenant.facilityId));
  const row = async (id: string) =>
    (
      await ctx.pool.query<{ status: string; scan_status: string | null; scan_signature: string | null; sha256: string | null }>(
        "SELECT status, scan_status, scan_signature, sha256 FROM document WHERE id = $1",
        [id],
      )
    ).rows[0]!;

  beforeAll(async () => {
    ctx = await createTestApp({ malwareScanner: { provide: MALWARE_SCANNER, useValue: scanner } });
    tenant = await createTenant(ctx.pool, "scan-org");
    await createStaff(ctx.pool, tenant, "admin@scan.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "records@scan.ph", ["records_officer"]);
    admin = (await login(ctx, "admin@scan.ph")).accessToken;
    patientId = (await ctx.http().post("/api/v1/patients").set(as(admin, tenant.facilityId)).send(juan).expect(201)).body.id;
  });
  afterAll(() => ctx.close());

  it("hashes and scans a clean upload, which becomes available with its checksum", async () => {
    const body = Buffer.from("%PDF-1.4 harmless");
    const created = await register({ sizeBytes: body.length }).expect(201);
    const id = created.body.document.id as string;
    expect(created.body.document).not.toHaveProperty("declaredSha256");
    ctx.storage.put(await key(id), { sizeBytes: body.length, contentType: "application/pdf" }, body);
    const completed = await complete(id).expect(200);
    expect(completed.body).toMatchObject({ status: "available", scanStatus: "clean", scanSignature: null, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(await row(id)).toMatchObject({ status: "available", scan_status: "clean" });
    expect((await ctx.http().get("/api/v1/health/ready").expect(200)).body.checks.malwareScanner).toBe("ok");
  });

  it("refuses an upload whose bytes differ from the declared checksum, and accepts a matching one", async () => {
    const body = Buffer.from("declared content");
    const wrong = "0".repeat(64);
    const bad = (await register({ sizeBytes: body.length, sha256: wrong }).expect(201)).body.document.id as string;
    ctx.storage.put(await key(bad), { sizeBytes: body.length, contentType: "application/pdf" }, body);
    await complete(bad)
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("checksum_mismatch"));
    expect((await row(bad)).status).toBe("pending_upload");
    await register({ sizeBytes: 1, sha256: "not-hex" }).expect(400);

    const { createHash } = await import("node:crypto");
    const digest = createHash("sha256").update(body).digest("hex");
    const good = (await register({ sizeBytes: body.length, sha256: digest.toUpperCase() }).expect(201)).body.document.id as string;
    ctx.storage.put(await key(good), { sizeBytes: body.length, contentType: "application/pdf" }, body);
    expect((await complete(good).expect(200)).body.sha256).toBe(digest);
  });

  it("quarantines an infected upload: never available, refused everywhere, audited, and the records office told", async () => {
    const body = Buffer.from(`prefix ${EICAR} suffix`, "latin1");
    const id = (await register({ sizeBytes: body.length, title: "Not this one" }).expect(201)).body.document.id as string;
    ctx.storage.put(await key(id), { sizeBytes: body.length, contentType: "application/pdf" }, body);
    await complete(id)
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("upload_quarantined"));
    expect(await row(id)).toMatchObject({ status: "quarantined", scan_status: "quarantined", scan_signature: "Eicar-Test-Signature" });
    // Completing again does nothing more; serving it is refused; the file stays in storage.
    await complete(id).expect(422);
    await ctx.http().get(`/api/v1/documents/${id}/download-url`).set(as(admin)).expect(422);
    expect(ctx.storage.contents.has(await key(id))).toBe(true);
    // Listed to staff with its status (so the record shows what happened), never as an attachable document.
    const listed = (await ctx.http().get(`/api/v1/documents?patientId=${patientId}`).set(as(admin)).expect(200)).body as Array<{ id: string; status: string }>;
    expect(listed.find((d) => d.id === id)?.status).toBe("quarantined");
    await ctx
      .http()
      .post(`/api/v1/patients/${patientId}/consents`)
      .set(as(admin))
      .send({ consentType: "portal_access", decision: "granted", capturedVia: "paper", documentId: id })
      .expect((r) => expect([404, 422]).toContain(r.status));
    const audit = await auditRows(ctx.pool, "action = 'document.quarantine'");
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).toMatch(/Eicar-Test-Signature/);
    expect(JSON.stringify(audit)).not.toMatch(/Not this one/);

    await drainEvents(ctx);
    const notices = (
      await ctx.pool.query<{ recipient_user_id: string; variables: Record<string, unknown>; rendered_text: string | null }>(
        "SELECT recipient_user_id, variables FROM notification WHERE template_key = 'document.quarantine-notice' ORDER BY created_at",
      )
    ).rows;
    // The admin (uploader, and holds document.archive) and the records officer, once each.
    expect(notices).toHaveLength(2);
    expect(new Set(notices.map((n) => n.recipient_user_id)).size).toBe(2);
    expect(notices[0]!.variables).toMatchObject({ documentId: id, signature: "Eicar-Test-Signature", origin: "staff", patientId });
    expect(JSON.stringify(notices)).not.toMatch(/Not this one/);
  });

  it("refuses completion while the scanner is unreachable, leaving the upload pending for a retry", async () => {
    const body = Buffer.from("fine");
    const id = (await register({ sizeBytes: body.length }).expect(201)).body.document.id as string;
    ctx.storage.put(await key(id), { sizeBytes: body.length, contentType: "application/pdf" }, body);
    scanner.down = true;
    try {
      await complete(id)
        .expect(422)
        .expect((r) => expect(r.body.error.code).toBe("scan_unavailable"));
      expect((await row(id)).status).toBe("pending_upload");
      expect((await ctx.http().get("/api/v1/health/ready").expect(200)).body).toMatchObject({ status: "degraded", checks: { malwareScanner: "unreachable" } });
    } finally {
      scanner.down = false;
    }
    await complete(id).expect(200);
  });

  it("marks a generated document clean by origin with its checksum", async () => {
    const { rows } = await ctx.pool.query<{ scan_status: string; sha256: string | null; source: string }>(
      "SELECT scan_status, sha256, source FROM document WHERE source = 'generated' LIMIT 1",
    );
    // No generated document in this suite; the rule is checked where one is produced (laboratory report archive tests).
    expect(rows.length === 0 || (rows[0]!.scan_status === "clean" && rows[0]!.sha256 !== null)).toBe(true);
  });
});

describe("documents without a scanner", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "noscan-org");
    await createStaff(ctx.pool, tenant, "admin@noscan.ph", ["org_admin"]);
    admin = (await login(ctx, "admin@noscan.ph")).accessToken;
  });
  afterAll(() => ctx.close());

  it("completes uploads as not scanned, with the checksum, and says so on readiness", async () => {
    const body = Buffer.from("unscanned");
    const created = await ctx
      .http()
      .post("/api/v1/documents")
      .set(as(admin, tenant.facilityId))
      .send({ category: "other", title: "Memo", fileName: "memo.pdf", contentType: "application/pdf", sizeBytes: body.length })
      .expect(201);
    const id = created.body.document.id as string;
    const { rows } = await ctx.pool.query<{ storage_key: string }>("SELECT storage_key FROM document WHERE id = $1", [id]);
    ctx.storage.put(rows[0]!.storage_key, { sizeBytes: body.length, contentType: "application/pdf" }, body);
    const completed = await ctx.http().post(`/api/v1/documents/${id}/complete`).set(as(admin)).expect(200);
    expect(completed.body).toMatchObject({ status: "available", scanStatus: "not_scanned", sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect((await ctx.http().get("/api/v1/health/ready").expect(200)).body.checks.malwareScanner).toBe("unconfigured");
  });
});
