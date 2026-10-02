import { Inject, Injectable } from "@nestjs/common";
import { AuditService, type PatientAuditContext } from "@healthcare/audit";
import {
  type Actor,
  BusinessRuleError,
  ConflictError,
  DATABASE,
  type Database,
  type DbExecutor,
  DomainEventPublisher,
  filedAsPatient,
  localDate,
  NotFoundError,
  VersionConflictError,
  isFiledAs,
} from "@healthcare/core";
import { DocumentsService, type DocumentView } from "@healthcare/documents";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import { PatientRecordService } from "../patient-record.service";
import type {
  declineRecordsRequestSchema,
  fulfilRecordsRequestSchema,
  prepareRecordCopySchema,
  recordsRequestSettingSchema,
  submitRecordsRequestSchema,
} from "./records-request.dto";
import {
  copySectionsForScope,
  daysWaiting,
  MAX_OPEN_RECORDS_REQUESTS,
  recordsRequestOpen,
  recordsRequestOverdue,
  respondByDate,
} from "./records-request.rules";
import {
  recordsRequest,
  recordsRequestDocument,
  recordsRequestExport,
  recordsRequestNumberSequence,
  type RecordsRequestRecord,
  recordsRequestSetting,
} from "./records-request.schema";

/** Records requests belong to the organization, not a facility: their dates are Philippine local dates. */
const REQUEST_TIME_ZONE = "Asia/Manila";

const OPEN = ["submitted", "in_review"] as const;

export type RecordsRequestView = Omit<RecordsRequestRecord, "organizationId" | "portalAccountId"> & { daysWaiting: number; overdue: boolean };

/** A shared document as the patient sees it: what it is and when it was shared, never storage details. */
export interface SharedRecord {
  documentId: string;
  title: string;
  category: string;
  sharedAt: Date;
}

/**
 * Records requests (docs/domains/records-requests.md): a patient asks in MyHealth for copies of their records; the
 * records office reviews the request, then shares documents from the patient's record or declines with a reason the
 * patient reads; the patient may withdraw while it is open. Shared documents are listed for the patient to download
 * (append-only). What the records office discloses, and when, follows the organization's own Data Privacy Act
 * procedures — no deadline or disclosure rule is encoded.
 */
@Injectable()
export class RecordsRequestService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
    private readonly documents: DocumentsService,
    private readonly records: PatientRecordService,
  ) {}

  // ---- the patient (MyHealth) --------------------------------------------------------------

  async submit(context: PatientAuditContext, input: z.infer<typeof submitRecordsRequestSchema>) {
    const created = await this.db.transaction(async (tx) => {
      // Serializes a patient's submissions, so the open-request limit holds.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`records-request:${context.patientId}`}))`);
      const [open] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(recordsRequest)
        .where(and(eq(recordsRequest.patientId, context.patientId), inArray(recordsRequest.status, [...OPEN])));
      if ((open?.count ?? 0) >= MAX_OPEN_RECORDS_REQUESTS) {
        throw new ConflictError(
          `You already have ${MAX_OPEN_RECORDS_REQUESTS} open requests. Wait for the records office to answer one, or withdraw one.`,
          undefined,
          "too_many_open_requests",
        );
      }
      const [setting] = await tx
        .select({ responseDays: recordsRequestSetting.responseDays })
        .from(recordsRequestSetting)
        .where(eq(recordsRequestSetting.organizationId, context.organizationId));
      const [counter] = await tx
        .insert(recordsRequestNumberSequence)
        .values({ organizationId: context.organizationId, nextValue: 1 })
        .onConflictDoUpdate({ target: recordsRequestNumberSequence.organizationId, set: { nextValue: sql`${recordsRequestNumberSequence.nextValue} + 1` } })
        .returning({ value: recordsRequestNumberSequence.nextValue });
      if (!counter) throw new Error("Could not allocate a request number");
      const [row] = await tx
        .insert(recordsRequest)
        .values({
          organizationId: context.organizationId,
          patientId: context.patientId,
          requestNumber: `RR${String(counter.value).padStart(8, "0")}`,
          scope: [...new Set(input.scope)],
          periodFrom: input.periodFrom ?? null,
          periodTo: input.periodTo ?? null,
          details: input.details || null,
          purpose: input.purpose || null,
          portalAccountId: context.accountId,
          respondBy: respondByDate(localDate(new Date(), REQUEST_TIME_ZONE), setting?.responseDays),
        })
        .returning();
      const request = found(row);
      await this.audit.record(tx, context, {
        action: "portal.records-request.submit",
        resourceType: "records_request",
        resourceId: request.id,
        patientId: context.patientId,
        metadata: { requestNumber: request.requestNumber, scope: request.scope },
      });
      await this.events.record(tx, requestEvent("RecordsRequestSubmitted", request));
      return request;
    });
    return view(created);
  }

  async withdraw(context: PatientAuditContext, requestId: string) {
    const withdrawn = await this.db.transaction(async (tx) => {
      const current = await this.lock(tx, context.organizationId, requestId);
      if (current.patientId !== context.patientId) throw new NotFoundError("Records request");
      if (!recordsRequestOpen(current.status)) throw new BusinessRuleError("This request has already been answered", "request_closed");
      const [row] = await tx
        .update(recordsRequest)
        .set({ status: "withdrawn", closedAt: new Date(), version: sql`${recordsRequest.version} + 1` })
        .where(eq(recordsRequest.id, requestId))
        .returning();
      const request = found(row);
      await this.audit.record(tx, context, {
        action: "portal.records-request.withdraw",
        resourceType: "records_request",
        resourceId: requestId,
        patientId: context.patientId,
      });
      await this.events.record(tx, requestEvent("RecordsRequestWithdrawn", request));
      return request;
    });
    return view(withdrawn);
  }

  /** The patient's requests, newest first, each with the documents shared in answer. */
  async forPatient(organizationId: string, patientId: string) {
    const rows = await this.db
      .select()
      .from(recordsRequest)
      .where(and(eq(recordsRequest.organizationId, organizationId), filedAsPatient(recordsRequest.patientId, patientId)))
      .orderBy(desc(recordsRequest.submittedAt));
    const shared = await this.shared(
      organizationId,
      rows.map((r) => r.id),
    );
    return rows.map((r) => ({
      id: r.id,
      requestNumber: r.requestNumber,
      scope: r.scope,
      periodFrom: r.periodFrom,
      periodTo: r.periodTo,
      details: r.details,
      purpose: r.purpose,
      status: r.status,
      submittedAt: r.submittedAt,
      respondBy: r.respondBy,
      closedAt: r.closedAt,
      responseNote: r.responseNote,
      // Only what is still available (an archived document is no longer offered).
      documents: (shared.get(r.id) ?? []).filter((d) => d.status === "available").map(sharedRecord),
    }));
  }

  /** A short-lived link for the patient to a document shared with them in answer to one of their requests. */
  async patientDocumentLink(context: PatientAuditContext, documentId: string) {
    const [row] = await this.db
      .select({ requestId: recordsRequestDocument.requestId })
      .from(recordsRequestDocument)
      .innerJoin(recordsRequest, eq(recordsRequest.id, recordsRequestDocument.requestId))
      .where(
        and(
          eq(recordsRequestDocument.organizationId, context.organizationId),
          filedAsPatient(recordsRequestDocument.patientId, context.patientId),
          eq(recordsRequestDocument.documentId, documentId),
          eq(recordsRequest.status, "fulfilled"),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundError("Document");
    return this.documents.downloadUrlForPatient(context, documentId);
  }

  // ---- the records office ------------------------------------------------------------------

  /** Open requests of the organization (a count for the navigation badge; not audited). */
  async countOpen(actor: Actor): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(recordsRequest)
      .where(and(eq(recordsRequest.organizationId, actor.organizationId), inArray(recordsRequest.status, [...OPEN])));
    return row?.count ?? 0;
  }

  async list(actor: Actor, status: "open" | "closed" | "all") {
    const filters = [eq(recordsRequest.organizationId, actor.organizationId)];
    if (status === "open") filters.push(inArray(recordsRequest.status, [...OPEN]));
    if (status === "closed") filters.push(inArray(recordsRequest.status, ["fulfilled", "declined", "withdrawn"]));
    const rows = await this.db
      .select()
      .from(recordsRequest)
      .where(and(...filters))
      .orderBy(status === "open" ? asc(recordsRequest.submittedAt) : desc(recordsRequest.submittedAt))
      .limit(200);
    const patients = await this.records.briefs(actor.organizationId, [...new Set(rows.map((r) => r.patientId))]);
    return rows.map((r) => ({ ...view(r), patient: patients.get(r.patientId) ?? null }));
  }

  /** One request with the patient, what was shared and the documents in the patient's record that could be (audited). */
  async get(actor: Actor, requestId: string) {
    const request = await this.lock(this.db, actor.organizationId, requestId);
    const [patients, shared, available, copies] = await Promise.all([
      this.records.briefs(actor.organizationId, [request.patientId]),
      this.shared(actor.organizationId, [request.id]),
      recordsRequestOpen(request.status) ? this.documents.listForPatient(actor, request.patientId, false) : Promise.resolve([] as DocumentView[]),
      this.db
        .select()
        .from(recordsRequestExport)
        .where(and(eq(recordsRequestExport.organizationId, actor.organizationId), eq(recordsRequestExport.requestId, request.id)))
        .orderBy(asc(recordsRequestExport.createdAt)),
    ]);
    await this.audit.recordStandalone(actor, {
      action: "patient.records-request.view",
      resourceType: "records_request",
      resourceId: request.id,
      patientId: request.patientId,
    });
    return {
      ...view(request),
      patient: patients.get(request.patientId) ?? null,
      shared: (shared.get(request.id) ?? []).map((d) => ({ ...sharedRecord(d), status: d.status })),
      available: available
        .filter((d) => d.status === "available")
        .map((d) => ({ id: d.id, title: d.title, category: d.category, fileName: d.fileName, createdAt: d.createdAt })),
      /** Copies of the record prepared for this request (each a record_copy document, shared like any other). */
      copies: copies.map((c) => ({ documentId: c.id, sections: c.sections, periodFrom: c.periodFrom, periodTo: c.periodTo, createdAt: c.createdAt })),
      /** Where a new copy starts from: the sections matching what the patient asked for. */
      suggestedSections: copySectionsForScope(request.scope),
    };
  }

  /** The request a copy of the record is prepared for: open, with its patient (the caller compiles and stores the copy). */
  async copyTarget(actor: Actor, requestId: string): Promise<RecordsRequestView> {
    const request = await this.lock(this.db, actor.organizationId, requestId);
    if (!recordsRequestOpen(request.status)) throw new BusinessRuleError("This request is closed", "request_closed");
    return view(request);
  }

  /**
   * Records a copy of the record stored as document `documentId` for the request, in the document's transaction (audited
   * once; idempotent, as a stored document's bookkeeping must be).
   */
  async recordCopy(
    tx: DbExecutor,
    actor: Actor,
    request: Pick<RecordsRequestView, "id" | "patientId" | "requestNumber">,
    documentId: string,
    input: z.infer<typeof prepareRecordCopySchema>,
  ): Promise<void> {
    const [current] = await tx
      .select({ status: recordsRequest.status })
      .from(recordsRequest)
      .where(and(eq(recordsRequest.organizationId, actor.organizationId), eq(recordsRequest.id, request.id)))
      .for("update");
    if (!current || !recordsRequestOpen(current.status)) throw new BusinessRuleError("This request is closed", "request_closed");
    const [inserted] = await tx
      .insert(recordsRequestExport)
      .values({
        id: documentId,
        organizationId: actor.organizationId,
        requestId: request.id,
        patientId: request.patientId,
        sections: [...new Set(input.sections)],
        periodFrom: input.periodFrom ?? null,
        periodTo: input.periodTo ?? null,
        createdBy: actor.userId,
      })
      .onConflictDoNothing()
      .returning({ id: recordsRequestExport.id });
    if (!inserted) return;
    await this.audit.record(tx, actor, {
      action: "patient.records-request.copy",
      resourceType: "records_request",
      resourceId: request.id,
      patientId: request.patientId,
      metadata: {
        requestNumber: request.requestNumber,
        documentId,
        sections: input.sections,
        periodFrom: input.periodFrom ?? null,
        periodTo: input.periodTo ?? null,
      },
    });
  }

  async startReview(actor: Actor, requestId: string, version: number) {
    return this.change(actor, requestId, version, "patient.records-request.review", async (tx, current) => {
      if (current.status !== "submitted") throw new BusinessRuleError("Only a newly submitted request is taken into review", "invalid_request_status");
      return { status: "in_review" as const, reviewStartedAt: new Date(), reviewStartedBy: actor.userId };
    });
  }

  async fulfil(actor: Actor, requestId: string, input: z.infer<typeof fulfilRecordsRequestSchema>) {
    const documentIds = [...new Set(input.documentIds)];
    return this.change(
      actor,
      requestId,
      input.version,
      "patient.records-request.fulfil",
      async (tx, current) => {
        const [setting] = await tx
          .select({ identityCheckRequired: recordsRequestSetting.identityCheckRequired })
          .from(recordsRequestSetting)
          .where(eq(recordsRequestSetting.organizationId, actor.organizationId));
        if (setting?.identityCheckRequired && !input.identityCheckMethod) {
          throw new BusinessRuleError("Record how you confirmed the requester's identity before sharing", "identity_check_required");
        }
        for (const documentId of documentIds) {
          // Ordinary documents only (a domain that manages its documents shares them itself), of this patient, available.
          const doc = await this.documents.get(actor, documentId).catch(() => undefined);
          // A document filed under a record merged into this patient is part of their record too (ADR-0009).
          if (!doc || doc.status !== "available" || !(await isFiledAs(tx, doc.patientId, current.patientId))) {
            throw new BusinessRuleError("Share only available documents from this patient's record", "document_not_shareable", { documentId });
          }
        }
        await tx.insert(recordsRequestDocument).values(
          documentIds.map((documentId) => ({
            organizationId: actor.organizationId,
            requestId,
            patientId: current.patientId,
            documentId,
            sharedBy: actor.userId,
          })),
        );
        const identity = input.identityCheckMethod
          ? { identityCheckMethod: input.identityCheckMethod, identityCheckedBy: actor.userId, identityCheckedAt: new Date() }
          : {};
        return { status: "fulfilled" as const, responseNote: input.note ?? null, closedAt: new Date(), closedBy: actor.userId, ...identity };
      },
      "RecordsRequestFulfilled",
      { documents: documentIds.length, identityChecked: Boolean(input.identityCheckMethod) },
    );
  }

  async decline(actor: Actor, requestId: string, input: z.infer<typeof declineRecordsRequestSchema>) {
    return this.change(
      actor,
      requestId,
      input.version,
      "patient.records-request.decline",
      async () => ({ status: "declined" as const, responseNote: input.reason, closedAt: new Date(), closedBy: actor.userId }),
      "RecordsRequestDeclined",
      {},
      input.reason,
    );
  }

  // ---- the organization's procedure ----------------------------------------------------------

  /** The organization's own procedure; defaults (none set) when never configured (version 0). */
  async setting(organizationId: string) {
    const [row] = await this.db.select().from(recordsRequestSetting).where(eq(recordsRequestSetting.organizationId, organizationId));
    if (!row) return { responseDays: null, identityCheckRequired: false, patientNotice: null, version: 0, updatedAt: null };
    return {
      responseDays: row.responseDays,
      identityCheckRequired: row.identityCheckRequired,
      patientNotice: row.patientNotice,
      version: row.version,
      updatedAt: row.updatedAt,
    };
  }

  async setSetting(actor: Actor, input: z.infer<typeof recordsRequestSettingSchema>) {
    await this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(recordsRequestSetting).where(eq(recordsRequestSetting.organizationId, actor.organizationId)).for("update");
      if ((current?.version ?? 0) !== input.version) throw new VersionConflictError("Records request setting", input.version);
      const values = {
        responseDays: input.responseDays,
        identityCheckRequired: input.identityCheckRequired,
        patientNotice: input.patientNotice,
        updatedBy: actor.userId,
        updatedAt: new Date(),
      };
      if (current) {
        await tx
          .update(recordsRequestSetting)
          .set({ ...values, version: current.version + 1 })
          .where(eq(recordsRequestSetting.organizationId, actor.organizationId));
      } else {
        await tx.insert(recordsRequestSetting).values({ organizationId: actor.organizationId, ...values });
      }
      await this.audit.record(tx, actor, {
        action: "patient.records-request.setting",
        resourceType: "organization",
        resourceId: actor.organizationId,
        changes: {
          responseDays: { from: current?.responseDays ?? null, to: input.responseDays },
          identityCheckRequired: { from: current?.identityCheckRequired ?? false, to: input.identityCheckRequired },
          patientNotice: { from: current?.patientNotice ?? null, to: input.patientNotice },
        },
      });
    });
    return this.setting(actor.organizationId);
  }

  // ---- internals ------------------------------------------------------------------------------

  private async change(
    actor: Actor,
    requestId: string,
    version: number,
    action: string,
    apply: (tx: DbExecutor, current: RecordsRequestRecord) => Promise<Partial<RecordsRequestRecord>>,
    event?: string,
    metadata: Record<string, unknown> = {},
    reason?: string,
  ) {
    const updated = await this.db.transaction(async (tx) => {
      const current = await this.lock(tx, actor.organizationId, requestId, true);
      if (current.version !== version) throw new ConflictError("The request changed; reload it", undefined, "version_conflict");
      if (!recordsRequestOpen(current.status)) throw new BusinessRuleError("This request is closed", "request_closed");
      const changes = await apply(tx, current);
      const [row] = await tx
        .update(recordsRequest)
        .set({ ...changes, version: sql`${recordsRequest.version} + 1` })
        .where(eq(recordsRequest.id, requestId))
        .returning();
      const request = found(row);
      await this.audit.record(tx, actor, {
        action,
        resourceType: "records_request",
        resourceId: requestId,
        patientId: request.patientId,
        reason,
        metadata: { requestNumber: request.requestNumber, status: request.status, ...metadata },
      });
      if (event) await this.events.record(tx, requestEvent(event, request));
      return request;
    });
    return view(updated);
  }

  private async lock(executor: DbExecutor, organizationId: string, requestId: string, forUpdate = false): Promise<RecordsRequestRecord> {
    const query = executor
      .select()
      .from(recordsRequest)
      .where(and(eq(recordsRequest.organizationId, organizationId), eq(recordsRequest.id, requestId)));
    const [row] = forUpdate ? await query.for("update") : await query;
    return found(row);
  }

  private async shared(organizationId: string, requestIds: string[]) {
    const map = new Map<string, Array<{ documentId: string; title: string; category: string; status: string; sharedAt: Date }>>();
    if (!requestIds.length) return map;
    const rows = await this.db
      .select({ requestId: recordsRequestDocument.requestId, documentId: recordsRequestDocument.documentId, sharedAt: recordsRequestDocument.sharedAt })
      .from(recordsRequestDocument)
      .where(and(eq(recordsRequestDocument.organizationId, organizationId), inArray(recordsRequestDocument.requestId, requestIds)))
      .orderBy(asc(recordsRequestDocument.sharedAt));
    const docs = await this.documents.describe(
      organizationId,
      rows.map((r) => r.documentId),
    );
    for (const r of rows) {
      const doc = docs.get(r.documentId);
      if (!doc) continue;
      const entry = { documentId: r.documentId, title: doc.title, category: doc.category, status: doc.status, sharedAt: r.sharedAt };
      map.set(r.requestId, [...(map.get(r.requestId) ?? []), entry]);
    }
    return map;
  }
}

function found(row: RecordsRequestRecord | undefined): RecordsRequestRecord {
  if (!row) throw new NotFoundError("Records request");
  return row;
}

function view(row: RecordsRequestRecord): RecordsRequestView {
  const { organizationId: _o, portalAccountId: _a, ...rest } = row;
  return {
    ...rest,
    daysWaiting: daysWaiting(row.submittedAt, row.closedAt ?? new Date()),
    overdue: recordsRequestOverdue(row, localDate(new Date(), REQUEST_TIME_ZONE)),
  };
}

function sharedRecord(d: { documentId: string; title: string; category: string; sharedAt: Date }): SharedRecord {
  return { documentId: d.documentId, title: d.title, category: d.category, sharedAt: d.sharedAt };
}

function requestEvent(type: string, row: RecordsRequestRecord) {
  return {
    type,
    organizationId: row.organizationId,
    aggregateType: "records_request",
    aggregateId: row.id,
    patientId: row.patientId,
    payload: { requestNumber: row.requestNumber, status: row.status },
  };
}
