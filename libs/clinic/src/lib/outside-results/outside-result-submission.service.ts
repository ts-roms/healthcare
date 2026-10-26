import { Inject, Injectable } from "@nestjs/common";
import { AuditService, type PatientAuditContext } from "@healthcare/audit";
import {
  type Actor,
  asPgError,
  BusinessRuleError,
  DATABASE,
  type Database,
  DomainEventPublisher,
  localDate,
  NotFoundError,
  PgErrorCode,
  PH_TIMEZONE,
} from "@healthcare/core";
import { DocumentsService } from "@healthcare/documents";
import { OrganizationService } from "@healthcare/organization";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import { found } from "../clinic-support";
import { HISTORY_STAFF_NAMES, type HistoryStaffNames } from "../history/ports";
import { PATIENT_DIRECTORY, type PatientDirectory } from "../ports";
import type { fileSubmissionSchema, submissionUploadSchema, submitOutsideResultSchema } from "./outside-result-submission.dto";
import { outsideResultSubmission, type OutsideResultSubmissionRecord, type OutsideResultSubmissionStatus } from "./outside-result-submission.schema";
import { OutsideResultService } from "./outside-result.service";

/** A patient may have this many submissions waiting at once, and upload this many files a day (MyHealth's own limit). */
export const MAX_OPEN_SUBMISSIONS = 3;
export const MAX_SUBMISSION_UPLOADS_PER_DAY = 10;

/** What the patient sees: what they sent, where it stands and, when declined, the reason. */
export interface PatientSubmissionView {
  id: string;
  status: OutsideResultSubmissionStatus;
  sourceName: string;
  tests: string;
  performedOn: string | null;
  notes: string | null;
  submittedAt: string;
  /** When the records office answered, or the patient withdrew it. */
  answeredAt: string | null;
  declineReason: string | null;
}

/** What the records office sees: the above, the patient and, once filed, the outside result made from it. */
export interface StaffSubmissionView extends PatientSubmissionView {
  documentId: string;
  outsideResultId: string | null;
  decidedByName: string | null;
  patient: { id: string; patientNumber: string; displayName: string };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

const toPatientView = (r: OutsideResultSubmissionRecord): PatientSubmissionView => ({
  id: r.id,
  status: r.status,
  sourceName: r.sourceName,
  tests: r.tests,
  performedOn: r.performedOn,
  notes: r.notes,
  submittedAt: r.submittedAt.toISOString(),
  answeredAt: iso(r.decidedAt ?? r.withdrawnAt),
  declineReason: r.status === "declined" ? r.decisionReason : null,
});

/**
 * Outside results sent by patients (docs/domains/outside-results.md, "Sent by patients"): the patient uploads a report
 * from another laboratory or hospital in MyHealth and says what it is in their own words; nothing is filed on their
 * record until the records office files it as an ordinary outside result (which a clinician then reviews) or declines
 * it with a reason the patient reads. The patient may withdraw it while it waits. The report is not read by the platform.
 */
@Injectable()
export class OutsideResultSubmissionService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
    private readonly documents: DocumentsService,
    private readonly organizations: OrganizationService,
    private readonly outsideResults: OutsideResultService,
    @Inject(HISTORY_STAFF_NAMES) private readonly staff: HistoryStaffNames,
    @Inject(PATIENT_DIRECTORY) private readonly patients: PatientDirectory,
  ) {}

  // ---- the patient (MyHealth) --------------------------------------------------------------------------------------

  /** Prepares an upload of the report (an image or a PDF; ten files a day; not while three submissions are waiting). */
  async startUpload(context: PatientAuditContext, input: z.output<typeof submissionUploadSchema>) {
    if ((await this.openCount(context)) >= MAX_OPEN_SUBMISSIONS) throw this.tooManyOpen();
    if ((await this.documents.patientUploadsToday(context)) >= MAX_SUBMISSION_UPLOADS_PER_DAY) {
      throw new BusinessRuleError("You have uploaded many files today. Try again tomorrow, or call the clinic.", "upload_rate_limited");
    }
    return this.documents.createForPatient(context, { title: "Result from another laboratory or hospital (sent by the patient)", ...input, category: "outside_result" });
  }

  completeUpload(context: PatientAuditContext, documentId: string) {
    return this.documents.completeUploadForPatient(context, documentId);
  }

  /** Sends the uploaded report to the records office with the patient's own description. */
  async submit(context: PatientAuditContext, input: z.output<typeof submitOutsideResultSchema>): Promise<PatientSubmissionView> {
    if (input.performedOn && input.performedOn > localDate(new Date(), PH_TIMEZONE)) throw new BusinessRuleError("The date given is in the future", "performed_on_in_future");
    if (!(await this.documents.isOwnPatientUpload(context, input.documentId))) {
      throw new BusinessRuleError("Upload the report first, then send it", "document_not_of_patient");
    }
    await this.outsideResults.assertReport(context.organizationId, context.patientId, input.documentId);
    let row: OutsideResultSubmissionRecord;
    try {
      row = await this.db.transaction(async (tx) => {
        // One patient's sending is serialized, so the limit holds.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`outside-result-submission:${context.patientId}`}, 0))`);
        const [open] = await tx
          .select({ n: count() })
          .from(outsideResultSubmission)
          .where(
            and(
              eq(outsideResultSubmission.organizationId, context.organizationId),
              eq(outsideResultSubmission.patientId, context.patientId),
              eq(outsideResultSubmission.status, "submitted"),
            ),
          );
        if ((open?.n ?? 0) >= MAX_OPEN_SUBMISSIONS) throw this.tooManyOpen();
        const [inserted] = await tx
          .insert(outsideResultSubmission)
          .values({
            organizationId: context.organizationId,
            patientId: context.patientId,
            portalAccountId: context.accountId,
            documentId: input.documentId,
            sourceName: input.sourceName,
            tests: input.tests,
            performedOn: input.performedOn ?? null,
            notes: input.notes ?? null,
          })
          .returning();
        const created = found(inserted, "Submission");
        await this.audit.record(tx, context, {
          action: "portal.outside-result-submit",
          resourceType: "outside_result_submission",
          resourceId: created.id,
          patientId: context.patientId,
          metadata: { documentId: created.documentId },
        });
        await this.events.record(tx, {
          type: "OutsideResultSubmitted",
          organizationId: context.organizationId,
          aggregateType: "outside_result_submission",
          aggregateId: created.id,
          facilityId: null,
          patientId: context.patientId,
          payload: { submissionId: created.id },
        });
        return created;
      });
    } catch (error) {
      if (asPgError(error)?.code === PgErrorCode.uniqueViolation) throw new BusinessRuleError("You already sent this report", "submission_exists");
      throw error;
    }
    return toPatientView(row);
  }

  /** The patient's own submissions, newest first. */
  async forPatient(context: PatientAuditContext): Promise<PatientSubmissionView[]> {
    const rows = await this.db
      .select()
      .from(outsideResultSubmission)
      .where(and(eq(outsideResultSubmission.organizationId, context.organizationId), eq(outsideResultSubmission.patientId, context.patientId)))
      .orderBy(desc(outsideResultSubmission.submittedAt))
      .limit(50);
    await this.audit.recordStandalone(context, {
      action: "portal.outside-result-view",
      resourceType: "outside_result_submission",
      patientId: context.patientId,
      metadata: { count: rows.length },
    });
    return rows.map(toPatientView);
  }

  /** The patient takes back a submission that is still waiting. */
  async withdraw(context: PatientAuditContext, submissionId: string): Promise<PatientSubmissionView> {
    const row = await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(outsideResultSubmission)
        .where(
          and(
            eq(outsideResultSubmission.organizationId, context.organizationId),
            eq(outsideResultSubmission.patientId, context.patientId),
            eq(outsideResultSubmission.id, submissionId),
          ),
        )
        .for("update");
      const submission = found(current, "Submission");
      if (submission.status !== "submitted") throw new BusinessRuleError("The records office has already answered this", "submission_answered");
      const [updated] = await tx
        .update(outsideResultSubmission)
        .set({ status: "withdrawn", withdrawnAt: new Date() })
        .where(eq(outsideResultSubmission.id, submissionId))
        .returning();
      await this.audit.record(tx, context, {
        action: "portal.outside-result-withdraw",
        resourceType: "outside_result_submission",
        resourceId: submissionId,
        patientId: context.patientId,
      });
      return found(updated, "Submission");
    });
    return toPatientView(row);
  }

  /** A short-lived link to the patient's own uploaded report (audited as the patient). */
  async linkForPatient(context: PatientAuditContext, submissionId: string) {
    const [row] = await this.db
      .select()
      .from(outsideResultSubmission)
      .where(
        and(
          eq(outsideResultSubmission.organizationId, context.organizationId),
          eq(outsideResultSubmission.patientId, context.patientId),
          eq(outsideResultSubmission.id, submissionId),
        ),
      );
    return this.documents.downloadUrlForPatient(context, found(row, "Submission").documentId);
  }

  // ---- the records office ------------------------------------------------------------------------------------------

  /** Submissions still waiting, oldest first (at most 100), with the patient. Each listed patient's access is audited. */
  async queue(actor: Actor): Promise<StaffSubmissionView[]> {
    const rows = await this.db
      .select()
      .from(outsideResultSubmission)
      .where(and(eq(outsideResultSubmission.organizationId, actor.organizationId), eq(outsideResultSubmission.status, "submitted")))
      .orderBy(asc(outsideResultSubmission.submittedAt), asc(outsideResultSubmission.id))
      .limit(100);
    const patientIds = [...new Set(rows.map((r) => r.patientId))];
    for (const patientId of patientIds) {
      await this.audit.recordStandalone(actor, {
        action: "outside-result.submission-view",
        resourceType: "outside_result_submission",
        patientId,
        metadata: { queue: "submitted" },
      });
    }
    return this.staffViews(actor.organizationId, rows);
  }

  /** How many submissions wait for the records office. A count only: nothing is audited. */
  async countOpen(actor: Actor): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(outsideResultSubmission)
      .where(and(eq(outsideResultSubmission.organizationId, actor.organizationId), eq(outsideResultSubmission.status, "submitted")));
    return row?.n ?? 0;
  }

  /** A short-lived link to the patient's report for the records office (audited by the documents service). */
  async link(actor: Actor, submissionId: string) {
    const [row] = await this.db
      .select()
      .from(outsideResultSubmission)
      .where(and(eq(outsideResultSubmission.organizationId, actor.organizationId), eq(outsideResultSubmission.id, submissionId)));
    return this.documents.downloadUrl(actor, found(row, "Submission").documentId);
  }

  /** Files the report on the patient's record as an outside result, with the records office's own reading of it. */
  async file(actor: Actor, submissionId: string, input: z.output<typeof fileSubmissionSchema>): Promise<StaffSubmissionView> {
    const timeZone = actor.facilityId ? (await this.organizations.getFacility(actor.organizationId, actor.facilityId)).timezone : PH_TIMEZONE;
    if (input.performedOn > localDate(new Date(), timeZone)) throw new BusinessRuleError("The date given is in the future", "performed_on_in_future");
    let row: OutsideResultSubmissionRecord;
    try {
      row = await this.db.transaction(async (tx) => {
        const submission = await this.lock(tx, actor.organizationId, submissionId);
        if (submission.status !== "submitted") throw new BusinessRuleError("This submission has already been answered", "submission_answered");
        await this.outsideResults.assertReport(actor.organizationId, submission.patientId, submission.documentId);
        const filing = await this.outsideResults.fileIn(tx, actor, submission.patientId, { ...input, documentId: submission.documentId, receivedFrom: "patient" });
        const [updated] = await tx
          .update(outsideResultSubmission)
          .set({ status: "filed", outsideResultId: filing.id, decidedBy: actor.userId, decidedAt: new Date() })
          .where(eq(outsideResultSubmission.id, submissionId))
          .returning();
        await this.answered(tx, actor, submission, "filed", { outsideResultId: filing.id });
        return found(updated, "Submission");
      });
    } catch (error) {
      throw this.outsideResults.filingError(error);
    }
    return (await this.staffViews(actor.organizationId, [row]))[0]!;
  }

  /** Declines the submission with a reason the patient reads; nothing is filed. */
  async decline(actor: Actor, submissionId: string, reason: string): Promise<StaffSubmissionView> {
    const row = await this.db.transaction(async (tx) => {
      const submission = await this.lock(tx, actor.organizationId, submissionId);
      if (submission.status !== "submitted") throw new BusinessRuleError("This submission has already been answered", "submission_answered");
      const [updated] = await tx
        .update(outsideResultSubmission)
        .set({ status: "declined", decisionReason: reason, decidedBy: actor.userId, decidedAt: new Date() })
        .where(eq(outsideResultSubmission.id, submissionId))
        .returning();
      await this.answered(tx, actor, submission, "declined", {});
      return found(updated, "Submission");
    });
    return (await this.staffViews(actor.organizationId, [row]))[0]!;
  }

  // ---- internals ---------------------------------------------------------------------------------------------------

  private async lock(tx: Parameters<Parameters<Database["transaction"]>[0]>[0], organizationId: string, id: string): Promise<OutsideResultSubmissionRecord> {
    const [row] = await tx
      .select()
      .from(outsideResultSubmission)
      .where(and(eq(outsideResultSubmission.organizationId, organizationId), eq(outsideResultSubmission.id, id)))
      .for("update");
    return found(row, "Submission");
  }

  private async answered(
    tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
    actor: Actor,
    submission: OutsideResultSubmissionRecord,
    outcome: "filed" | "declined",
    extra: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record(tx, actor, {
      action: outcome === "filed" ? "outside-result.submission-file" : "outside-result.submission-decline",
      resourceType: "outside_result_submission",
      resourceId: submission.id,
      patientId: submission.patientId,
      metadata: { documentId: submission.documentId, ...extra },
    });
    await this.events.record(tx, {
      type: "OutsideResultSubmissionAnswered",
      organizationId: actor.organizationId,
      aggregateType: "outside_result_submission",
      aggregateId: submission.id,
      facilityId: null,
      patientId: submission.patientId,
      payload: { submissionId: submission.id, outcome },
    });
  }

  private async openCount(context: PatientAuditContext): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(outsideResultSubmission)
      .where(
        and(
          eq(outsideResultSubmission.organizationId, context.organizationId),
          eq(outsideResultSubmission.patientId, context.patientId),
          eq(outsideResultSubmission.status, "submitted"),
        ),
      );
    return row?.n ?? 0;
  }

  private tooManyOpen(): BusinessRuleError {
    return new BusinessRuleError(
      `You already have ${MAX_OPEN_SUBMISSIONS} results waiting for the records office. Send another once they have answered one.`,
      "too_many_open_submissions",
    );
  }

  private async staffViews(organizationId: string, rows: OutsideResultSubmissionRecord[]): Promise<StaffSubmissionView[]> {
    const patientIds = [...new Set(rows.map((r) => r.patientId))];
    const userIds = [...new Set(rows.map((r) => r.decidedBy).filter((id): id is string => Boolean(id)))];
    const [briefs, names] = await Promise.all([
      this.patients.summaries(organizationId, patientIds),
      userIds.length ? this.staff.staffNames(organizationId, userIds) : Promise.resolve(new Map<string, string>()),
    ]);
    return rows.flatMap((r) => {
      const brief = briefs.get(r.patientId);
      if (!brief) throw new NotFoundError("Patient");
      return [
        {
          ...toPatientView(r),
          documentId: r.documentId,
          outsideResultId: r.outsideResultId,
          decidedByName: r.decidedBy ? (names.get(r.decidedBy) ?? null) : null,
          patient: { id: r.patientId, patientNumber: brief.patientNumber, displayName: brief.displayName },
        },
      ];
    });
  }
}
