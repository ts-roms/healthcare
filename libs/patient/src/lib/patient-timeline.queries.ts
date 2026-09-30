import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database, filedAsPatient, timelineInstant, timelineRange, type TimelineWindow } from "@healthcare/core";
import { and, desc, eq } from "drizzle-orm";
import { patientConsent } from "./patient.schema";
import { recordsRequest } from "./records-requests/records-request.schema";

/**
 * Patient-domain read queries for the patient timeline (composed in apps/api): consent decisions and records
 * requests, newest first within a page window, with types, decisions, numbers and statuses only — never notes,
 * details, purposes or response notes. Both belong to the organization's record (no facility), so a facility
 * filter leaves them out. Not audited here: the caller audits.
 */
@Injectable()
export class PatientTimelineQueries {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Consent decisions when they took effect: type, decision, how captured, and whether the patient recorded it in MyHealth. */
  timelineConsents(organizationId: string, patientId: string, window: TimelineWindow) {
    if (window.facilityIds) return Promise.resolve([]);
    const at = patientConsent.effectiveAt;
    return this.db
      .select({
        id: patientConsent.id,
        patientId: patientConsent.patientId,
        at: timelineInstant(at),
        consentType: patientConsent.consentType,
        decision: patientConsent.decision,
        capturedVia: patientConsent.capturedVia,
        byPatient: patientConsent.recordedByPortalAccount,
      })
      .from(patientConsent)
      .where(
        and(
          eq(patientConsent.organizationId, organizationId),
          filedAsPatient(patientConsent.patientId, patientId),
          timelineRange("consent", at, patientConsent.id, window),
        ),
      )
      .orderBy(desc(at), desc(patientConsent.id))
      .limit(window.limit);
  }

  /** Records requests when submitted: number, what was asked for (fixed scopes) and status. */
  timelineRecordsRequests(organizationId: string, patientId: string, window: TimelineWindow) {
    if (window.facilityIds) return Promise.resolve([]);
    const at = recordsRequest.submittedAt;
    return this.db
      .select({
        id: recordsRequest.id,
        patientId: recordsRequest.patientId,
        at: timelineInstant(at),
        requestNumber: recordsRequest.requestNumber,
        scope: recordsRequest.scope,
        status: recordsRequest.status,
      })
      .from(recordsRequest)
      .where(
        and(
          eq(recordsRequest.organizationId, organizationId),
          filedAsPatient(recordsRequest.patientId, patientId),
          timelineRange("records_request", at, recordsRequest.id, window),
        ),
      )
      .orderBy(desc(at), desc(recordsRequest.id))
      .limit(window.limit);
  }
}
