import { createHash } from "node:crypto";
import { DocumentIntegrityService } from "@healthcare/documents";
import { as, auditRows, createStaff, createTenant, createTestApp, drainEvents, juan, login, type Tenant, type TestContext } from "./harness";

/**
 * Integrity review of stored documents (migration 0105, docs/domains/documents.md): a run reads every available
 * document back from storage and compares it with its recorded hash; a mismatch or a missing file becomes a finding
 * that withholds the document until the records office resolves it; a document without a hash is baselined.
 */
describe("document integrity review", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let records: string;
  let patientId: string;
  const docs: Record<string, string> = {};

  const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  const key = async (id: string) =>
    (await ctx.pool.query<{ storage_key: string }>("SELECT storage_key FROM document WHERE id = $1", [id])).rows[0]!.storage_key;
  const upload = async (title: string, body: Buffer, category = "clinical_attachment"): Promise<string> => {
    const created = await ctx
      .http()
      .post("/api/v1/documents")
      .set(as(admin, tenant.facilityId))
      .send({ category, title, fileName: `${title}.pdf`, contentType: "application/pdf", sizeBytes: body.length, patientId })
      .expect(201);
    const id = created.body.document.id as string;
    ctx.storage.put(await key(id), { sizeBytes: body.length, contentType: "application/pdf" }, body);
    await ctx.http().post(`/api/v1/documents/${id}/complete`).set(as(admin, tenant.facilityId)).expect(200);
    return id;
  };
  const integrity = () => ctx.app.get(DocumentIntegrityService);
  const startRun = (body: Record<string, unknown> = {}) => ctx.http().post("/api/v1/document-integrity/runs").set(as(records)).send(body);
  const runNow = async (body: Record<string, unknown> = {}) => {
    const run = (await startRun(body).expect(202)).body as { id: string };
    expect(await integrity().runPending()).toBe(1);
    return (await ctx.http().get(`/api/v1/document-integrity/runs/${run.id}`).set(as(records)).expect(200)).body as Record<string, unknown>;
  };
  const docRow = async (id: string) =>
    (await ctx.pool.query<{ integrity_status: string | null; sha256: string | null }>("SELECT integrity_status, sha256 FROM document WHERE id = $1", [id]))
      .rows[0]!;
  const findings = async (status = "open") =>
    (await ctx.http().get(`/api/v1/document-integrity/findings?status=${status}`).set(as(records)).expect(200)).body as {
      findings: Array<{ id: string; outcome: string; document: { id: string; title: string } }>;
      more: boolean;
    };

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "integrity-org");
    await createStaff(ctx.pool, tenant, "admin@integrity.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "records@integrity.ph", ["records_officer"]);
    await createStaff(ctx.pool, tenant, "nurse@integrity.ph", ["nurse"]);
    admin = (await login(ctx, "admin@integrity.ph")).accessToken;
    records = (await login(ctx, "records@integrity.ph")).accessToken;
    patientId = (await ctx.http().post("/api/v1/patients").set(as(admin, tenant.facilityId)).send(juan).expect(201)).body.id;
    docs.fine = await upload("Fine", Buffer.from("%PDF-1.4 fine"));
    docs.altered = await upload("Altered later", Buffer.from("%PDF-1.4 original"));
    docs.gone = await upload("Gone later", Buffer.from("%PDF-1.4 gone"));
    docs.flaky = await upload("Storage down", Buffer.from("%PDF-1.4 flaky"));
    docs.old = await upload("Stored before 0098", Buffer.from("%PDF-1.4 old"), "identification");
    // A document stored before migration 0098 has no recorded hash.
    await ctx.pool.query("UPDATE document SET sha256 = NULL WHERE id = $1", [docs.old]);
  });
  afterAll(() => ctx.close());

  it("needs document.integrity.manage", async () => {
    const nurse = (await login(ctx, "nurse@integrity.ph")).accessToken;
    await ctx.http().get("/api/v1/document-integrity/runs").set(as(nurse)).expect(403);
    await startRun().set(as(nurse)).expect(403);
    await ctx.http().get("/api/v1/document-integrity/findings").set(as(nurse)).expect(403);
  });

  it("verifies every document whose bytes match, baselines one without a hash, and reports the counts", async () => {
    const run = await runNow();
    expect(run).toMatchObject({ status: "completed", checked: 5, verified: 4, baselined: 1, mismatched: 0, missing: 0, unreadable: 0 });
    expect(run).not.toHaveProperty("cursorDocumentId");
    expect(await docRow(docs.fine)).toMatchObject({ integrity_status: "verified" });
    const old = await docRow(docs.old);
    expect(old).toMatchObject({ integrity_status: "baselined", sha256: sha(Buffer.from("%PDF-1.4 old")) });
    expect(await auditRows(ctx.pool, "action = 'document.integrity.baseline' AND resource_id = $1", [docs.old])).toHaveLength(1);
    expect(await auditRows(ctx.pool, "action = 'document.integrity.completed'")).toHaveLength(1);
    expect((await findings()).findings).toEqual([]);
    const listed = (await ctx.http().get("/api/v1/document-integrity/runs").set(as(records)).expect(200)).body;
    expect(listed.openFindings).toBe(0);
    expect(listed.runs[0]).toMatchObject({ id: run.id, status: "completed" });
  });

  it("finds altered and missing files, withholds those documents everywhere, tells the records office, and serves them again once resolved", async () => {
    // Between runs the bytes of one document change in storage and another's file disappears; storage fails for a third.
    const alteredKey = await key(docs.altered);
    ctx.storage.put(alteredKey, { sizeBytes: 20, contentType: "application/pdf" }, Buffer.from("%PDF-1.4 tampered!!"));
    const goneKey = await key(docs.gone);
    ctx.storage.objects.delete(goneKey);
    ctx.storage.contents.delete(goneKey);
    const flakyKey = await key(docs.flaky);
    const get = ctx.storage.get.bind(ctx.storage);
    ctx.storage.get = async (k: string) => {
      if (k === flakyKey) throw new Error("connection reset");
      return get(k);
    };
    try {
      const run = await runNow();
      expect(run).toMatchObject({ status: "completed", checked: 5, verified: 2, baselined: 0, mismatched: 1, missing: 1, unreadable: 1 });
    } finally {
      ctx.storage.get = get;
    }
    expect(await docRow(docs.altered)).toMatchObject({ integrity_status: "mismatch", sha256: sha(Buffer.from("%PDF-1.4 original")) });
    expect(await docRow(docs.gone)).toMatchObject({ integrity_status: "missing" });
    expect(await docRow(docs.flaky)).toMatchObject({ integrity_status: "unreadable" });
    // The previously baselined document now verifies.
    expect(await docRow(docs.old)).toMatchObject({ integrity_status: "verified" });

    const open = await findings();
    expect(open.findings.map((f) => [f.document.id, f.outcome]).sort()).toEqual(
      [
        [docs.altered, "mismatch"],
        [docs.gone, "missing"],
        [docs.flaky, "unreadable"],
      ].sort(),
    );
    const mismatch = open.findings.find((f) => f.document.id === docs.altered)!;
    expect(mismatch).toMatchObject({ recordedSha256: sha(Buffer.from("%PDF-1.4 original")), computedSha256: sha(Buffer.from("%PDF-1.4 tampered!!")) });

    // Withheld: a mismatch and a missing file refuse every reader; storage that did not answer never blocks.
    const refused = await ctx.http().get(`/api/v1/documents/${docs.altered}/download-url`).set(as(admin)).expect(422);
    expect(refused.body.error.code).toBe("document_integrity_failed");
    await ctx
      .http()
      .get(`/api/v1/documents/${docs.gone}/download-url`)
      .set(as(admin))
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("document_integrity_failed"));
    await ctx.http().get(`/api/v1/documents/${docs.flaky}/download-url`).set(as(admin)).expect(200);
    await ctx.http().get(`/api/v1/documents/${docs.fine}/download-url`).set(as(admin)).expect(200);
    // The document view says so, without hashes of anything else.
    expect((await ctx.http().get(`/api/v1/documents/${docs.altered}`).set(as(admin)).expect(200)).body).toMatchObject({ integrityStatus: "mismatch" });

    // The records office (document.archive holders at the facility) is told about the mismatch and the missing file, not the unreadable one.
    await drainEvents(ctx);
    const notices = (
      await ctx.pool.query<{ recipient_user_id: string; variables: Record<string, unknown> }>(
        "SELECT recipient_user_id, variables FROM notification WHERE template_key = 'document.integrity-notice' ORDER BY created_at",
      )
    ).rows;
    expect(notices.map((n) => n.variables.outcome).sort()).toEqual(["mismatch", "mismatch", "missing", "missing"]);
    expect(new Set(notices.map((n) => n.recipient_user_id)).size).toBe(2);
    expect(JSON.stringify(notices)).not.toMatch(/Altered later|Gone later/);

    // Audited as findings (ids and outcome, never titles).
    const audit = await auditRows(ctx.pool, "action = 'document.integrity.finding'");
    expect(audit).toHaveLength(3);
    expect(JSON.stringify(audit)).not.toMatch(/Altered later/);

    // A second run over the still-open findings adds nothing.
    const again = await runNow();
    expect(again).toMatchObject({ mismatched: 1, missing: 1 });
    expect((await findings()).findings).toHaveLength(3);

    // Resolving once, with a note, serves the document again; resolving twice is refused; the note is audited.
    await ctx.http().post(`/api/v1/document-integrity/findings/${mismatch.id}/resolve`).set(as(records)).send({ note: "Too" }).expect(400);
    const resolved = (
      await ctx
        .http()
        .post(`/api/v1/document-integrity/findings/${mismatch.id}/resolve`)
        .set(as(records))
        .send({ note: "Restored from backup, reviewed" })
        .expect(200)
    ).body;
    expect(resolved).toMatchObject({ id: mismatch.id, resolutionNote: "Restored from backup, reviewed", document: { id: docs.altered } });
    await ctx
      .http()
      .post(`/api/v1/document-integrity/findings/${mismatch.id}/resolve`)
      .set(as(records))
      .send({ note: "Again, by mistake" })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("integrity_finding_resolved"));
    await ctx.http().get(`/api/v1/documents/${docs.altered}/download-url`).set(as(admin)).expect(200);
    expect((await findings("resolved")).findings.map((f) => f.id)).toEqual([mismatch.id]);
    expect((await findings()).findings).toHaveLength(2);
    expect(await auditRows(ctx.pool, "action = 'document.integrity.resolve' AND resource_id = $1", [mismatch.id])).toHaveLength(1);
    // A resolved finding never changes and is never deleted.
    await expect(ctx.pool.query("UPDATE document_integrity_finding SET resolution_note = 'x' WHERE id = $1", [mismatch.id])).rejects.toThrow(/never changes/);
    await expect(ctx.pool.query("DELETE FROM document_integrity_finding WHERE id = $1", [mismatch.id])).rejects.toThrow(/never deleted/);
  });

  it("runs one review at a time per organization, over one category when asked, and can be cancelled", async () => {
    const queued = (await startRun({ category: "identification" }).expect(202)).body as { id: string; category: string };
    expect(queued.category).toBe("identification");
    await startRun()
      .expect(409)
      .expect((r) => expect(r.body.error.code).toBe("integrity_run_in_progress"));
    const cancelled = (await ctx.http().post(`/api/v1/document-integrity/runs/${queued.id}/cancel`).set(as(records)).expect(200)).body;
    expect(cancelled).toMatchObject({ status: "cancelled", checked: 0 });
    await ctx.http().post(`/api/v1/document-integrity/runs/${queued.id}/cancel`).set(as(records)).expect(422);
    expect(await integrity().runPending()).toBe(0);

    const one = await runNow({ category: "identification" });
    expect(one).toMatchObject({ status: "completed", checked: 1, verified: 1 });
    await startRun({ category: "not-a-category" }).expect(400);
  });
});
