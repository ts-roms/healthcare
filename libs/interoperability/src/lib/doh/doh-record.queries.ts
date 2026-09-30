import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database, filedAsPatient, timelineFacility, timelineInstant, timelineRange, type TimelineWindow } from "@healthcare/core";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { dohCaseReport } from "./doh.schema";

/**
 * DOH case reports for the patient timeline (composed in apps/api): when a report was opened for review
 * (`step = opened`, source `doh_case_opened`) and when it was last reviewed — recorded as reported, dismissed or submitted (`step = reviewed`, source
 * `doh_case_reviewed`), with the organization's own category label and the current status — never the diagnosis
 * display, the reason given or the reference. Not audited here: the caller audits.
 */
@Injectable()
export class DohRecordQueries {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  timelineCaseReports(organizationId: string, patientId: string, window: TimelineWindow, step: "opened" | "reviewed") {
    const at = step === "opened" ? dohCaseReport.detectedAt : dohCaseReport.reviewedAt;
    return this.db
      .select({
        id: dohCaseReport.id,
        patientId: dohCaseReport.patientId,
        at: timelineInstant(at),
        facilityId: dohCaseReport.facilityId,
        category: dohCaseReport.category,
        status: dohCaseReport.status,
        encounterId: dohCaseReport.encounterId,
      })
      .from(dohCaseReport)
      .where(
        and(
          eq(dohCaseReport.organizationId, organizationId),
          filedAsPatient(dohCaseReport.patientId, patientId),
          isNotNull(at),
          timelineFacility(dohCaseReport.facilityId, window),
          timelineRange(step === "opened" ? "doh_case_opened" : "doh_case_reviewed", at, dohCaseReport.id, window),
        ),
      )
      .orderBy(desc(at), desc(dohCaseReport.id))
      .limit(window.limit);
  }
}
