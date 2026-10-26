import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  type Actor,
  asPgError,
  BusinessRuleError,
  DATABASE,
  type Database,
  DomainEventPublisher,
  filedAsPatient,
  isFiledAs,
  timelineFacility,
  timelineInstant,
  timelineRange,
  type TimelineWindow,
  localDate,
  NotFoundError,
  PgErrorCode,
  PH_TIMEZONE,
} from "@healthcare/core";
import { DocumentsService } from "@healthcare/documents";
import { OrganizationService } from "@healthcare/organization";
import { and, asc, count, desc, eq, isNull, or } from "drizzle-orm";
import type { z } from "zod";
import { found } from "../clinic-support";
import { HISTORY_STAFF_NAMES, type HistoryStaffNames } from "../history/ports";
import { PATIENT_DIRECTORY, type PatientDirectory } from "../ports";
import type { recordOutsideResultSchema } from "./outside-result.dto";
import { outsideResult, type OutsideResultRecord } from "./outside-result.schema";

/** One filed outside result as staff see it. */
export interface OutsideResultView {
  id: string;
  /** The record it is filed under (the patient, or a record merged into it). */
  patientId: string;
  facility: { id: string; name: string } | null;
  documentId: string;
  sourceName: string;
  sourceKind: OutsideResultRecord["sourceKind"];
  performedOn: string;
  tests: string;
  receivedFrom: OutsideResultRecord["receivedFrom"];
  notes: string | null;
  enteredInError: { at: string; reason: string; byName: string | null } | null;
  /** Null until a clinician records that they read it (never for an entry in error). */
  review: { at: string; byName: string | null; note: string | null } | null;
  recordedAt: string;
  recordedByName: string | null;
}

/** A filing awaiting review, with the patient it is filed for. */
export interface UnreviewedOutsideResult extends OutsideResultView {
  patient: { id: string; patientNumber: string; displayName: string };
}

/**
 * Results from outside laboratories and hospitals (docs/domains/outside-results.md): the uploaded report filed on the
 * patient's record with its source, the day it was done and the tests as the report names them. Never one of this
 * laboratory's results: nothing is entered, verified, released, flagged, converted or trended, and the report's content
 * is not read. Records are immutable; a mistake is marked entered in error with a reason (never deleted).
 */
@Injectable()
export class OutsideResultService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
    private readonly documents: DocumentsService,
    private readonly organizations: OrganizationService,
    @Inject(HISTORY_STAFF_NAMES) private readonly staff: HistoryStaffNames,
    @Inject(PATIENT_DIRECTORY) private readonly patients: PatientDirectory,
  ) {}

  /** Files an uploaded report on the patient's record. */
  async record(actor: Actor, patientId: string, input: z.output<typeof recordOutsideResultSchema>): Promise<OutsideResultView> {
    if (!(await this.patients.summaries(actor.organizationId, [patientId])).has(patientId)) throw new NotFoundError("Patient");
    const timeZone = actor.facilityId ? (await this.organizations.getFacility(actor.organizationId, actor.facilityId)).timezone : PH_TIMEZONE;
    if (input.performedOn > localDate(new Date(), timeZone)) throw new BusinessRuleError("The date given is in the future", "performed_on_in_future");
    const doc = (await this.documents.describe(actor.organizationId, [input.documentId])).get(input.documentId);
    if (!doc || doc.category !== "outside_result" || !doc.patientId || !(await isFiledAs(this.db, doc.patientId, patientId))) {
      throw new BusinessRuleError("Upload the report for this patient first", "document_not_of_patient");
    }
    if (doc.status !== "available") throw new BusinessRuleError("The report has not finished uploading", "document_unavailable");

    let row: OutsideResultRecord;
    try {
      row = await this.db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(outsideResult)
          .values({
            organizationId: actor.organizationId,
            patientId,
            facilityId: actor.facilityId ?? null,
            documentId: input.documentId,
            sourceName: input.sourceName,
            sourceKind: input.sourceKind,
            performedOn: input.performedOn,
            tests: input.tests,
            receivedFrom: input.receivedFrom,
            notes: input.notes ?? null,
            recordedBy: actor.userId,
          })
          .returning();
        const created = found(inserted, "Outside result");
        await this.audit.record(tx, actor, {
          action: "outside-result.record",
          resourceType: "outside_result",
          resourceId: created.id,
          patientId,
          metadata: { documentId: created.documentId, sourceKind: created.sourceKind, receivedFrom: created.receivedFrom },
        });
        await this.events.record(tx, {
          type: "OutsideResultFiled",
          organizationId: actor.organizationId,
          aggregateType: "outside_result",
          aggregateId: created.id,
          facilityId: created.facilityId,
          patientId,
          payload: { outsideResultId: created.id, documentId: created.documentId },
        });
        return created;
      });
    } catch (error) {
      const pg = asPgError(error);
      if (pg?.code === PgErrorCode.uniqueViolation) throw new BusinessRuleError("This report is already filed", "outside_result_exists");
      throw error;
    }
    return (await this.views(actor.organizationId, [row]))[0]!;
  }

  /** The patient's filed outside results (and those of records merged into it), latest first; entries in error included, marked. */
  async list(actor: Actor, patientId: string): Promise<OutsideResultView[]> {
    if (!(await this.patients.summaries(actor.organizationId, [patientId])).has(patientId)) throw new NotFoundError("Patient");
    const rows = await this.db
      .select()
      .from(outsideResult)
      .where(and(eq(outsideResult.organizationId, actor.organizationId), filedAsPatient(outsideResult.patientId, patientId)))
      .orderBy(desc(outsideResult.performedOn), desc(outsideResult.recordedAt))
      .limit(500);
    await this.audit.recordStandalone(actor, {
      action: "outside-result.view",
      resourceType: "outside_result",
      patientId,
      metadata: { count: rows.length },
    });
    return this.views(actor.organizationId, rows);
  }

  /** The latest filings for Patient 360 (not in error): source, tests and day only, no notes. Not audited here: the caller audits. */
  async workspace(organizationId: string, patientId: string, limit: number) {
    const rows = await this.db
      .select()
      .from(outsideResult)
      .where(and(eq(outsideResult.organizationId, organizationId), filedAsPatient(outsideResult.patientId, patientId), isNull(outsideResult.enteredInErrorAt)))
      .orderBy(desc(outsideResult.performedOn), desc(outsideResult.recordedAt))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      patientId: r.patientId,
      facilityId: r.facilityId,
      sourceName: r.sourceName,
      sourceKind: r.sourceKind,
      performedOn: r.performedOn,
      tests: r.tests,
      receivedFrom: r.receivedFrom,
      reviewed: r.reviewedAt !== null,
      recordedAt: r.recordedAt.toISOString(),
    }));
  }

  /**
   * Timeline rows: when it was filed. Tests, source and day only (the notes stay on the record); a facility filter matches
   * the facility it was filed at. Not audited here: the caller audits.
   */
  timeline(organizationId: string, patientId: string, window: TimelineWindow) {
    const at = outsideResult.recordedAt;
    return this.db
      .select({
        id: outsideResult.id,
        patientId: outsideResult.patientId,
        facilityId: outsideResult.facilityId,
        at: timelineInstant(at),
        documentId: outsideResult.documentId,
        sourceName: outsideResult.sourceName,
        performedOn: outsideResult.performedOn,
        tests: outsideResult.tests,
        enteredInErrorAt: outsideResult.enteredInErrorAt,
        reviewedAt: outsideResult.reviewedAt,
      })
      .from(outsideResult)
      .where(
        and(
          eq(outsideResult.organizationId, organizationId),
          filedAsPatient(outsideResult.patientId, patientId),
          timelineRange("outside_result", at, outsideResult.id, window),
          timelineFacility(outsideResult.facilityId, window),
        ),
      )
      .orderBy(desc(at), desc(outsideResult.id))
      .limit(window.limit);
  }

  /**
   * Records that a clinician read the report, once; never on an entry in error. It says nothing about what the report
   * shows and changes nothing else.
   */
  async review(actor: Actor, outsideResultId: string, note?: string): Promise<OutsideResultView> {
    const row = await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(outsideResult)
        .where(and(eq(outsideResult.organizationId, actor.organizationId), eq(outsideResult.id, outsideResultId)))
        .for("update");
      const filed = found(current, "Outside result");
      if (filed.enteredInErrorAt) throw new BusinessRuleError("The record is marked entered in error", "already_entered_in_error");
      if (filed.reviewedAt) throw new BusinessRuleError("This report has already been reviewed", "already_reviewed");
      const [updated] = await tx
        .update(outsideResult)
        .set({ reviewedAt: new Date(), reviewedBy: actor.userId, reviewNote: note ?? null })
        .where(eq(outsideResult.id, outsideResultId))
        .returning();
      await this.audit.record(tx, actor, {
        action: "outside-result.review",
        resourceType: "outside_result",
        resourceId: outsideResultId,
        patientId: filed.patientId,
        metadata: { documentId: filed.documentId, withNote: Boolean(note) },
      });
      await this.events.record(tx, {
        type: "OutsideResultReviewed",
        organizationId: actor.organizationId,
        aggregateType: "outside_result",
        aggregateId: outsideResultId,
        facilityId: filed.facilityId,
        patientId: filed.patientId,
        payload: { outsideResultId, documentId: filed.documentId },
      });
      return found(updated, "Outside result");
    });
    return (await this.views(actor.organizationId, [row]))[0]!;
  }

  /**
   * Filings awaiting review across patients, oldest first (at most 100; the selected facility's and those filed without
   * one). Each listed patient's access is audited.
   */
  async unreviewed(actor: Actor): Promise<UnreviewedOutsideResult[]> {
    const rows = await this.db
      .select()
      .from(outsideResult)
      .where(
        and(
          eq(outsideResult.organizationId, actor.organizationId),
          isNull(outsideResult.reviewedAt),
          isNull(outsideResult.enteredInErrorAt),
          actor.facilityId ? or(eq(outsideResult.facilityId, actor.facilityId), isNull(outsideResult.facilityId)) : undefined,
        ),
      )
      .orderBy(asc(outsideResult.recordedAt), asc(outsideResult.id))
      .limit(100);
    const patientIds = [...new Set(rows.map((r) => r.patientId))];
    const [views, briefs] = await Promise.all([this.views(actor.organizationId, rows), this.patients.summaries(actor.organizationId, patientIds)]);
    for (const patientId of patientIds) {
      await this.audit.recordStandalone(actor, {
        action: "outside-result.view",
        resourceType: "outside_result",
        patientId,
        metadata: { queue: "unreviewed" },
      });
    }
    return views.flatMap((v) => {
      const brief = briefs.get(v.patientId);
      return brief ? [{ ...v, patient: { id: v.patientId, patientNumber: brief.patientNumber, displayName: brief.displayName } }] : [];
    });
  }

  /** How many filings await review (the selected facility's and those filed without one). A count only: nothing is audited. */
  async countUnreviewed(actor: Actor): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(outsideResult)
      .where(
        and(
          eq(outsideResult.organizationId, actor.organizationId),
          isNull(outsideResult.reviewedAt),
          isNull(outsideResult.enteredInErrorAt),
          actor.facilityId ? or(eq(outsideResult.facilityId, actor.facilityId), isNull(outsideResult.facilityId)) : undefined,
        ),
      );
    return row?.n ?? 0;
  }

  /** A short-lived link to the report (the documents service audits it). */
  async downloadUrl(actor: Actor, outsideResultId: string): Promise<{ url: string; expiresAt: string }> {
    const [row] = await this.db
      .select()
      .from(outsideResult)
      .where(and(eq(outsideResult.organizationId, actor.organizationId), eq(outsideResult.id, outsideResultId)));
    return this.documents.downloadUrl(actor, found(row, "Outside result").documentId);
  }

  /** Marks a filing entered in error with a reason (never deleted; the report stays in storage). */
  async markEnteredInError(actor: Actor, outsideResultId: string, reason: string): Promise<OutsideResultView> {
    const row = await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(outsideResult)
        .where(and(eq(outsideResult.organizationId, actor.organizationId), eq(outsideResult.id, outsideResultId)))
        .for("update");
      const filed = found(current, "Outside result");
      if (filed.enteredInErrorAt) throw new BusinessRuleError("The record is already marked entered in error", "already_entered_in_error");
      const [updated] = await tx
        .update(outsideResult)
        .set({ enteredInErrorAt: new Date(), enteredInErrorBy: actor.userId, enteredInErrorReason: reason })
        .where(eq(outsideResult.id, outsideResultId))
        .returning();
      await this.audit.record(tx, actor, {
        action: "outside-result.entered-in-error",
        resourceType: "outside_result",
        resourceId: outsideResultId,
        patientId: filed.patientId,
        reason,
        changes: { status: { from: "filed", to: "entered_in_error" } },
      });
      return found(updated, "Outside result");
    });
    return (await this.views(actor.organizationId, [row]))[0]!;
  }

  private async views(organizationId: string, rows: OutsideResultRecord[]): Promise<OutsideResultView[]> {
    const userIds = [...new Set(rows.flatMap((r) => [r.recordedBy, r.enteredInErrorBy, r.reviewedBy]).filter((id): id is string => Boolean(id)))];
    const [names, facilities] = await Promise.all([
      userIds.length ? this.staff.staffNames(organizationId, userIds) : Promise.resolve(new Map<string, string>()),
      rows.some((r) => r.facilityId) ? this.organizations.listFacilities(organizationId) : Promise.resolve([]),
    ]);
    const facilityName = new Map(facilities.map((f) => [f.id, f.name]));
    return rows.map((r) => ({
      id: r.id,
      patientId: r.patientId,
      facility: r.facilityId ? { id: r.facilityId, name: facilityName.get(r.facilityId) ?? "" } : null,
      documentId: r.documentId,
      sourceName: r.sourceName,
      sourceKind: r.sourceKind,
      performedOn: r.performedOn,
      tests: r.tests,
      receivedFrom: r.receivedFrom,
      notes: r.notes,
      enteredInError:
        r.enteredInErrorAt && r.enteredInErrorReason
          ? {
              at: r.enteredInErrorAt.toISOString(),
              reason: r.enteredInErrorReason,
              byName: r.enteredInErrorBy ? (names.get(r.enteredInErrorBy) ?? null) : null,
            }
          : null,
      review: r.reviewedAt ? { at: r.reviewedAt.toISOString(), byName: r.reviewedBy ? (names.get(r.reviewedBy) ?? null) : null, note: r.reviewNote } : null,
      recordedAt: r.recordedAt.toISOString(),
      recordedByName: names.get(r.recordedBy) ?? null,
    }));
  }
}
