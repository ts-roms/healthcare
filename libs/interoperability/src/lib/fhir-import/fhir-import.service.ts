import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  type Actor,
  APP_CONFIG,
  type AppConfig,
  BusinessRuleError,
  DATABASE,
  type Database,
  type DbExecutor,
  EncryptionKeyUnavailableError,
  ForbiddenError,
  integrationPayloadKeyring,
  type Keyring,
  NotFoundError,
  openWithKeyring,
  sealWithKeyring,
  sha256Hex,
  VersionConflictError,
} from "@healthcare/core";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { canonicalJson } from "../exchange/canonical-json";
import { fhirImport, fhirImportContent, fhirImportEntry, type FhirImportEntryRecord, type FhirImportRecord, type FhirImportStatus } from "./fhir-import.schema";
import { type ImportedItem, type ImportedPatient, importKind, type ImportOrigin } from "./inbound-model";
import { mapInboundEntries, registrationDraft, toAllergyInput, toExternalHistory } from "./inbound-mapping";
import { FhirImportError, type ParsedImport, parseImport } from "./inbound-validation";
import { type DuplicateOverride, FHIR_IMPORT_TARGETS, type FhirImportTargets, type RegistrationDraft } from "./ports";

/** Idempotency-Key header format (as the platform's IdempotencyInterceptor accepts). */
const VALID_KEY = /^[A-Za-z0-9._:-]{8,128}$/;

export interface ReceivedImport {
  id: string;
  status: FhirImportStatus;
  entryCount: number;
  resourceCounts: Record<string, number>;
  notSupported: number;
  /** True when this key was received before (the same content): nothing new was stored. */
  replayed: boolean;
}

/** What accepting an entry of each kind creates. */
function becomes(kind: string): "allergy" | "external_history" | "patient_match" | null {
  if (kind === "allergy") return "allergy";
  if (kind === "patient") return "patient_match";
  if (kind === "not_supported") return null;
  return "external_history";
}

/**
 * FHIR R4 inbound (docs/interoperability/fhir.md, "Inbound"): received content goes into a review queue, never
 * straight into the record. The content is sealed with the integration payload key ring; staff match the patient
 * (nothing is linked automatically) and accept or reject each entry. Accepting writes through the owning domain's
 * commands (ports wired in apps/api). Every receipt, view, match, accept and reject is audited.
 */
@Injectable()
export class FhirImportService {
  private readonly keyring: Keyring;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(FHIR_IMPORT_TARGETS) private readonly targets: FhirImportTargets,
    private readonly audit: AuditService,
  ) {
    this.keyring = integrationPayloadKeyring(config);
  }

  // ---- receive ------------------------------------------------------------------------------------------------

  /**
   * Validates and stores a Bundle or single resource for review. Idempotent by the caller's Idempotency-Key, else by
   * Bundle.identifier: the same key with the same content returns the first import; with other content it is refused.
   */
  async receive(actor: Actor, body: unknown, idempotencyKey: string | undefined): Promise<ReceivedImport> {
    const parsed = parseImport(body);
    if (idempotencyKey !== undefined && !VALID_KEY.test(idempotencyKey)) {
      throw new FhirImportError("Invalid Idempotency-Key", 400, [
        { code: "value", diagnostics: "Idempotency-Key must be 8-128 characters of [A-Za-z0-9._:-]" },
      ]);
    }
    const key = idempotencyKey
      ? `key:${idempotencyKey}`
      : parsed.bundleIdentifier
        ? `bundle-identifier:${parsed.bundleIdentifier.system ?? ""}|${parsed.bundleIdentifier.value}`
        : undefined;
    if (!key) {
      throw new FhirImportError("An idempotency key is required", 400, [
        { code: "required", diagnostics: "Send an Idempotency-Key header, or a Bundle with an identifier, so a retried import is not received twice" },
      ]);
    }
    const plaintext = canonicalJson(body);
    const contentDigest = sha256Hex(plaintext);
    const keyDigest = sha256Hex(key);
    const resourceCounts = countTypes(parsed);
    const notSupported = parsed.entries.filter((e) => importKind(e.resourceType) === "not_supported").length;

    const result = await this.db.transaction(async (tx) => {
      const inserted = (await tx
        .insert(fhirImport)
        .values({
          organizationId: actor.organizationId,
          idempotencyKeyDigest: keyDigest,
          contentDigest,
          sourceKind: parsed.sourceKind,
          bundleType: parsed.bundleType,
          declaredSource: parsed.declaredSource,
          resourceCounts,
          entryCount: parsed.entries.length,
          receivedBy: actor.userId,
        })
        .onConflictDoNothing({ target: [fhirImport.organizationId, fhirImport.idempotencyKeyDigest] })
        .returning()) as FhirImportRecord[];
      const row = inserted[0];
      if (!row) return undefined;
      const { keyId, sealed } = sealWithKeyring(plaintext, this.keyring);
      await tx.insert(fhirImportContent).values({ importId: row.id, organizationId: actor.organizationId, keyId, ciphertext: sealed });
      await tx.insert(fhirImportEntry).values(
        parsed.entries.map((e) => {
          const kind = importKind(e.resourceType);
          return {
            organizationId: actor.organizationId,
            importId: row.id,
            entryIndex: e.index,
            resourceType: e.resourceType,
            kind,
            outcome: kind === "not_supported" ? ("not_supported" as const) : ("pending" as const),
          };
        }),
      );
      await this.audit.record(tx, actor, {
        action: "fhir.import.receive",
        resourceType: "fhir_import",
        resourceId: row.id,
        metadata: { resourceCounts, entries: parsed.entries.length, notSupported, contentDigest, bundleType: parsed.bundleType, keyId },
      });
      return row;
    });
    if (result) return { id: result.id, status: result.status, entryCount: result.entryCount, resourceCounts, notSupported, replayed: false };

    const [existing] = await this.db
      .select()
      .from(fhirImport)
      .where(and(eq(fhirImport.organizationId, actor.organizationId), eq(fhirImport.idempotencyKeyDigest, keyDigest)));
    if (!existing) throw new Error("Import vanished after an idempotency conflict");
    if (existing.contentDigest !== contentDigest) {
      throw new FhirImportError("This idempotency key was used for other content", 409, [
        { code: "conflict", diagnostics: "The idempotency key (or Bundle.identifier) was already used for different content; use a new key for new content" },
      ]);
    }
    await this.audit.recordStandalone(actor, {
      action: "fhir.import.receive",
      resourceType: "fhir_import",
      resourceId: existing.id,
      metadata: { replayed: true, contentDigest },
    });
    return {
      id: existing.id,
      status: existing.status,
      entryCount: existing.entryCount,
      resourceCounts: existing.resourceCounts,
      notSupported: Object.entries(existing.resourceCounts)
        .filter(([t]) => importKind(t) === "not_supported")
        .reduce((n, [, c]) => n + c, 0),
      replayed: true,
    };
  }

  // ---- review -------------------------------------------------------------------------------------------------

  async list(actor: Actor, status?: FhirImportStatus) {
    const conditions = [eq(fhirImport.organizationId, actor.organizationId)];
    if (status) conditions.push(eq(fhirImport.status, status));
    const rows = await this.db
      .select()
      .from(fhirImport)
      .where(and(...conditions))
      .orderBy(sql`${fhirImport.status} = 'pending_review' DESC`, desc(fhirImport.receivedAt))
      .limit(200);
    const pending = rows.length
      ? await this.db
          .select({ importId: fhirImportEntry.importId, count: sql<number>`count(*)::int` })
          .from(fhirImportEntry)
          .where(
            and(
              eq(fhirImportEntry.organizationId, actor.organizationId),
              eq(fhirImportEntry.outcome, "pending"),
              sql`${fhirImportEntry.importId} IN (${sql.join(
                rows.map((r) => sql`${r.id}::uuid`),
                sql`, `,
              )})`,
            ),
          )
          .groupBy(fhirImportEntry.importId)
      : [];
    const pendingById = new Map(pending.map((p) => [p.importId, Number(p.count)]));
    const briefs = await this.targets.patientBriefs(actor.organizationId, [...new Set(rows.flatMap((r) => (r.patientId ? [r.patientId] : [])))]);
    await this.audit.recordStandalone(actor, {
      action: "fhir.import.list",
      resourceType: "fhir_import",
      metadata: { status: status ?? null, count: rows.length },
    });
    return rows.map((r) => ({ ...summary(r), pendingEntries: pendingById.get(r.id) ?? 0, patient: r.patientId ? (briefs.get(r.patientId) ?? null) : null }));
  }

  /** One import in readable form: each entry as the platform understood it, its outcome and what accepting it creates. */
  async get(actor: Actor, importId: string) {
    const row = await this.find(this.db, actor.organizationId, importId);
    const entries = await this.entries(this.db, row.id);
    const items = await this.items(row);
    const importedPatient = items?.find((i): i is ImportedPatient => i.kind === "patient") ?? null;
    const draft = importedPatient ? this.draft(importedPatient) : undefined;
    const patient = row.patientId ? ((await this.targets.patient(actor.organizationId, row.patientId)) ?? null) : null;
    await this.audit.recordStandalone(actor, {
      action: "fhir.import.view",
      resourceType: "fhir_import",
      resourceId: row.id,
      patientId: row.patientId ?? undefined,
    });
    return {
      ...summary(row),
      patient,
      importedPatient,
      registration: { possible: Boolean(draft), draft: draft ?? null },
      entries: entries.map((e) => ({
        id: e.id,
        index: e.entryIndex,
        resourceType: e.resourceType,
        kind: e.kind,
        becomes: becomes(e.kind),
        outcome: e.outcome,
        reason: e.reason,
        resultType: e.resultType,
        resultId: e.resultId,
        decidedAt: e.decidedAt?.toISOString() ?? null,
        item: items?.[e.entryIndex] ?? null,
      })),
    };
  }

  /** Candidates from the patient domain's duplicate detection for the imported Patient (none without enough demographics). */
  async candidates(actor: Actor, importId: string) {
    const row = await this.find(this.db, actor.organizationId, importId);
    const items = await this.items(row);
    const importedPatient = items?.find((i): i is ImportedPatient => i.kind === "patient");
    const draft = importedPatient ? this.draft(importedPatient) : undefined;
    const candidates = draft ? await this.targets.duplicateCandidates(actor, draft) : [];
    await this.audit.recordStandalone(actor, {
      action: "fhir.import.candidates",
      resourceType: "fhir_import",
      resourceId: row.id,
      metadata: { candidateIds: candidates.map((c) => c.patient.id) },
    });
    return { searchable: Boolean(draft), candidates };
  }

  /** Links the import to an existing patient (a person's decision). Allowed again until an entry was accepted for that patient. */
  async match(actor: Actor, importId: string, input: { patientId: string; version: number }) {
    const target = await this.targets.patient(actor.organizationId, input.patientId);
    if (!target) throw new NotFoundError("Patient");
    if (target.status === "merged") throw new BusinessRuleError("This record was merged into another patient; match the surviving record", "patient_merged");
    await this.db.transaction(async (tx) => {
      const row = await this.lockPending(tx, actor.organizationId, importId, input.version);
      await this.linkPatient(tx, actor, row, input.patientId, false);
    });
    return this.get(actor, importId);
  }

  /**
   * Registers a new patient from the imported Patient through the patient domain — the same duplicate review as the
   * registration form (possible duplicates are refused unless reviewed with a reason; a shared identifier never) — and
   * links the import to them. Requires patient.register as well.
   */
  async registerPatient(actor: Actor, importId: string, input: { version: number; duplicateOverride?: DuplicateOverride }) {
    if (!actor.permissions.has("patient.register")) throw new ForbiddenError("Registering a patient requires patient.register");
    const row = await this.find(this.db, actor.organizationId, importId);
    assertPendingState(row, input.version);
    const items = await this.items(row);
    const importedPatient = items?.find((i): i is ImportedPatient => i.kind === "patient");
    const draft = importedPatient ? this.draft(importedPatient) : undefined;
    if (!draft) {
      throw new BusinessRuleError(
        "The imported Patient lacks a name, full birth date or sex: register through the registration form, then match",
        "registration_incomplete",
      );
    }
    await this.assertNoClinicalAccepted(this.db, row.id);
    const patientId = await this.targets.registerPatient(actor, draft, input.duplicateOverride);
    await this.db.transaction(async (tx) => {
      const locked = await this.lockPending(tx, actor.organizationId, importId, input.version);
      await this.linkPatient(tx, actor, locked, patientId, true);
    });
    return this.get(actor, importId);
  }

  /** Accepts one entry: written through the owning domain for the matched patient, in one transaction with the outcome. */
  async accept(actor: Actor, importId: string, entryId: string) {
    await this.db.transaction(async (tx) => {
      const row = await this.lockPending(tx, actor.organizationId, importId);
      if (!row.patientId) throw new BusinessRuleError("Match the patient first", "patient_not_matched");
      const entry = await this.pendingEntry(tx, row.id, entryId);
      if (entry.kind === "patient") throw new BusinessRuleError("The Patient entry is decided by matching the patient", "entry_is_patient");
      const items = await this.items(row);
      const item = items?.[entry.entryIndex];
      if (!item) throw new BusinessRuleError("The received content is no longer available", "content_purged");
      if (!item.acceptable) throw new BusinessRuleError(`This entry cannot be accepted: ${item.notes.join(" ")}`, "entry_not_acceptable");
      const origin: ImportOrigin = {
        importId: row.id,
        entryId: entry.id,
        reference: `fhir-import:${row.id}#${entry.entryIndex}`,
        declaredSource: row.declaredSource,
      };
      let resultType: "allergy_intolerance" | "external_history_entry";
      let resultId: string;
      if (item.kind === "allergy") {
        resultType = "allergy_intolerance";
        resultId = await this.targets.recordAllergy(tx, actor, row.patientId, toAllergyInput(item), origin);
      } else if (item.kind === "condition" || item.kind === "observation" || item.kind === "medication" || item.kind === "document") {
        resultType = "external_history_entry";
        resultId = await this.targets.recordExternalHistory(tx, actor, row.patientId, toExternalHistory(item), origin);
      } else {
        throw new BusinessRuleError("This entry cannot be accepted", "entry_not_acceptable");
      }
      await tx
        .update(fhirImportEntry)
        .set({ outcome: "accepted", resultType, resultId, decidedBy: actor.userId, decidedAt: new Date() })
        .where(eq(fhirImportEntry.id, entry.id));
      await this.audit.record(tx, actor, {
        action: "fhir.import.entry-accept",
        resourceType: "fhir_import",
        resourceId: row.id,
        patientId: row.patientId,
        metadata: { entryId: entry.id, entryIndex: entry.entryIndex, resourceType: entry.resourceType, resultType, resultId },
      });
      await this.settle(tx, actor, row);
    });
    return this.get(actor, importId);
  }

  async reject(actor: Actor, importId: string, entryId: string, reason: string) {
    await this.db.transaction(async (tx) => {
      const row = await this.lockPending(tx, actor.organizationId, importId);
      const entry = await this.pendingEntry(tx, row.id, entryId);
      await tx
        .update(fhirImportEntry)
        .set({ outcome: "rejected", reason, decidedBy: actor.userId, decidedAt: new Date() })
        .where(eq(fhirImportEntry.id, entry.id));
      await this.audit.record(tx, actor, {
        action: "fhir.import.entry-reject",
        resourceType: "fhir_import",
        resourceId: row.id,
        patientId: row.patientId ?? undefined,
        reason,
        metadata: { entryId: entry.id, entryIndex: entry.entryIndex, resourceType: entry.resourceType },
      });
      await this.settle(tx, actor, row);
    });
    return this.get(actor, importId);
  }

  /** Rejects every entry still pending, with one reason, and closes the import (e.g. wrong recipient, not our patient). */
  async rejectImport(actor: Actor, importId: string, input: { reason: string; version: number }) {
    await this.db.transaction(async (tx) => {
      const row = await this.lockPending(tx, actor.organizationId, importId, input.version);
      const rejected = await tx
        .update(fhirImportEntry)
        .set({ outcome: "rejected", reason: input.reason, decidedBy: actor.userId, decidedAt: new Date() })
        .where(and(eq(fhirImportEntry.importId, row.id), eq(fhirImportEntry.outcome, "pending")))
        .returning({ id: fhirImportEntry.id });
      await this.audit.record(tx, actor, {
        action: "fhir.import.reject",
        resourceType: "fhir_import",
        resourceId: row.id,
        patientId: row.patientId ?? undefined,
        reason: input.reason,
        metadata: { entriesRejected: rejected.length },
      });
      await this.settle(tx, actor, row, input.reason);
    });
    return this.get(actor, importId);
  }

  // ---- internals ----------------------------------------------------------------------------------------------

  private draft(p: ImportedPatient): RegistrationDraft | undefined {
    const raw = registrationDraft(p);
    return raw ? this.targets.refineDraft(raw) : undefined;
  }

  /** The received content, opened and mapped; null once purged by the retention rule. */
  private async items(row: FhirImportRecord): Promise<ImportedItem[] | null> {
    const [content] = await this.db.select().from(fhirImportContent).where(eq(fhirImportContent.importId, row.id));
    if (!content) return null;
    let plaintext: string;
    try {
      plaintext = openWithKeyring(content.ciphertext, this.keyring);
    } catch (error) {
      if (error instanceof EncryptionKeyUnavailableError) {
        throw new BusinessRuleError(`The import is sealed with key "${error.keyId}", which is not configured`, "encryption_key_unavailable");
      }
      throw error;
    }
    const parsed = parseImport(JSON.parse(plaintext));
    const items = mapInboundEntries({ identifierSystems: this.config.FHIR_IDENTIFIER_SYSTEMS }, parsed);
    // Indexed by entry index (entries are stored with the Bundle's own positions).
    const byIndex: ImportedItem[] = [];
    parsed.entries.forEach((e, i) => (byIndex[e.index] = items[i]!));
    return byIndex;
  }

  private async find(executor: DbExecutor, organizationId: string, id: string, lock = false): Promise<FhirImportRecord> {
    const query = executor
      .select()
      .from(fhirImport)
      .where(and(eq(fhirImport.organizationId, organizationId), eq(fhirImport.id, id)));
    const [row] = lock ? await query.for("update") : await query;
    if (!row) throw new NotFoundError("Import");
    return row;
  }

  private async lockPending(tx: DbExecutor, organizationId: string, id: string, version?: number): Promise<FhirImportRecord> {
    const row = await this.find(tx, organizationId, id, true);
    assertPendingState(row, version);
    return row;
  }

  private entries(executor: DbExecutor, importId: string): Promise<FhirImportEntryRecord[]> {
    return executor.select().from(fhirImportEntry).where(eq(fhirImportEntry.importId, importId)).orderBy(asc(fhirImportEntry.entryIndex));
  }

  private async pendingEntry(tx: DbExecutor, importId: string, entryId: string): Promise<FhirImportEntryRecord> {
    const [entry] = await tx
      .select()
      .from(fhirImportEntry)
      .where(and(eq(fhirImportEntry.importId, importId), eq(fhirImportEntry.id, entryId)))
      .for("update");
    if (!entry) throw new NotFoundError("Import entry");
    if (entry.outcome !== "pending") throw new BusinessRuleError(`The entry is already ${entry.outcome.replace("_", " ")}`, "entry_decided");
    return entry;
  }

  private async assertNoClinicalAccepted(executor: DbExecutor, importId: string): Promise<void> {
    const [accepted] = await executor
      .select({ id: fhirImportEntry.id })
      .from(fhirImportEntry)
      .where(and(eq(fhirImportEntry.importId, importId), eq(fhirImportEntry.outcome, "accepted"), sql`${fhirImportEntry.kind} <> 'patient'`))
      .limit(1);
    if (accepted) throw new BusinessRuleError("Entries were already accepted for the matched patient; the match cannot change", "match_locked");
  }

  /** Sets the patient and marks the Patient entry as used for the match. */
  private async linkPatient(tx: DbExecutor, actor: Actor, row: FhirImportRecord, patientId: string, registered: boolean): Promise<void> {
    if (row.patientId && row.patientId !== patientId) await this.assertNoClinicalAccepted(tx, row.id);
    await tx.update(fhirImport).set({ patientId, matchedBy: actor.userId, matchedAt: new Date() }).where(eq(fhirImport.id, row.id));
    await tx
      .update(fhirImportEntry)
      .set({ outcome: "accepted", resultType: "patient", resultId: patientId, decidedBy: actor.userId, decidedAt: new Date() })
      .where(and(eq(fhirImportEntry.importId, row.id), eq(fhirImportEntry.kind, "patient")));
    await this.audit.record(tx, actor, {
      action: "fhir.import.match",
      resourceType: "fhir_import",
      resourceId: row.id,
      patientId,
      metadata: { previousPatientId: row.patientId, registered },
    });
    await this.settle(tx, actor, { ...row, patientId });
  }

  /** Completes the import once no entry is pending: accepted, partially accepted or rejected. */
  private async settle(tx: DbExecutor, actor: Actor, row: FhirImportRecord, rejectionReason?: string): Promise<void> {
    const entries = await this.entries(tx, row.id);
    const reviewable = entries.filter((e) => e.kind !== "not_supported");
    const version = sql`${fhirImport.version} + 1`;
    if (reviewable.some((e) => e.outcome === "pending") || (reviewable.length === 0 && !rejectionReason)) {
      await tx.update(fhirImport).set({ version }).where(eq(fhirImport.id, row.id));
      return;
    }
    const clinical = reviewable.filter((e) => e.kind !== "patient");
    const counted = clinical.length > 0 ? clinical : reviewable;
    const accepted = counted.filter((e) => e.outcome === "accepted").length;
    const rejected = counted.filter((e) => e.outcome === "rejected").length;
    const status: FhirImportStatus = accepted === 0 ? "rejected" : rejected === 0 ? "accepted" : "partially_accepted";
    await tx
      .update(fhirImport)
      .set({ status, completedBy: actor.userId, completedAt: new Date(), rejectionReason: rejectionReason ?? null, version })
      .where(eq(fhirImport.id, row.id));
    await this.audit.record(tx, actor, {
      action: "fhir.import.complete",
      resourceType: "fhir_import",
      resourceId: row.id,
      patientId: row.patientId ?? undefined,
      metadata: { status, accepted, rejected },
    });
  }
}

function assertPendingState(row: FhirImportRecord, version?: number): void {
  if (version !== undefined && row.version !== version) throw new VersionConflictError("Import", version);
  if (row.status !== "pending_review") throw new BusinessRuleError(`The import is already ${row.status.replace("_", " ")}`, "import_completed");
}

function countTypes(parsed: ParsedImport): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of parsed.entries) counts[e.resourceType] = (counts[e.resourceType] ?? 0) + 1;
  return counts;
}

function summary(r: FhirImportRecord) {
  return {
    id: r.id,
    status: r.status,
    sourceKind: r.sourceKind,
    bundleType: r.bundleType,
    declaredSource: r.declaredSource,
    resourceCounts: r.resourceCounts,
    entryCount: r.entryCount,
    patientId: r.patientId,
    matchedAt: r.matchedAt?.toISOString() ?? null,
    rejectionReason: r.rejectionReason,
    receivedAt: r.receivedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    contentPurged: r.contentPurgedAt !== null,
    version: r.version,
  };
}
