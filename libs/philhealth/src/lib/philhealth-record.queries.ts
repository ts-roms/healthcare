import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database, filedAsPatient, timelineFacility, timelineInstant, timelineRange, type TimelineWindow } from "@healthcare/core";
import { integrationExchange } from "@healthcare/interoperability";
import { and, desc, eq } from "drizzle-orm";
import { PHILHEALTH_ECLAIMS_SYSTEM } from "./gateway";
import { philhealthEligibilityCheck, philhealthYakapRegistration } from "./philhealth.schema";

/**
 * PhilHealth read queries for the patient timeline (composed in apps/api): claim submissions, eligibility answers and
 * YAKAP registration answers, newest first within a page window — statuses, dates and PhilHealth's references only,
 * never notes or outcome details. Not audited here: the caller audits.
 */
@Injectable()
export class PhilHealthRecordQueries {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * eClaims submissions (outbound exchanges for an invoice) when requested, with the exchange status and PhilHealth's
   * reference — never the payload, errors or outcome detail. Exchanges carry no facility, so a facility filter leaves
   * them out. Source `philhealth_claim`.
   */
  timelineClaims(organizationId: string, patientId: string, window: TimelineWindow) {
    if (window.facilityIds) return Promise.resolve([]);
    const at = integrationExchange.requestedAt;
    return this.db
      .select({
        id: integrationExchange.id,
        patientId: integrationExchange.patientId,
        at: timelineInstant(at),
        status: integrationExchange.status,
        externalReference: integrationExchange.externalReference,
        invoiceId: integrationExchange.resourceId,
      })
      .from(integrationExchange)
      .where(
        and(
          eq(integrationExchange.organizationId, organizationId),
          filedAsPatient(integrationExchange.patientId, patientId),
          eq(integrationExchange.system, PHILHEALTH_ECLAIMS_SYSTEM),
          eq(integrationExchange.resourceType, "billing_invoice"),
          timelineRange("philhealth_claim", at, integrationExchange.id, window),
        ),
      )
      .orderBy(desc(at), desc(integrationExchange.id))
      .limit(window.limit);
  }

  /** Eligibility answers (and inquiries) when recorded: the date of service, status, how answered and PhilHealth's reference. Source `philhealth_eligibility`. */
  timelineEligibility(organizationId: string, patientId: string, window: TimelineWindow) {
    const at = philhealthEligibilityCheck.createdAt;
    return this.db
      .select({
        id: philhealthEligibilityCheck.id,
        patientId: philhealthEligibilityCheck.patientId,
        at: timelineInstant(at),
        facilityId: philhealthEligibilityCheck.facilityId,
        serviceDate: philhealthEligibilityCheck.serviceDate,
        status: philhealthEligibilityCheck.status,
        source: philhealthEligibilityCheck.source,
        externalReference: philhealthEligibilityCheck.externalReference,
      })
      .from(philhealthEligibilityCheck)
      .where(
        and(
          eq(philhealthEligibilityCheck.organizationId, organizationId),
          filedAsPatient(philhealthEligibilityCheck.patientId, patientId),
          timelineFacility(philhealthEligibilityCheck.facilityId, window),
          timelineRange("philhealth_eligibility", at, philhealthEligibilityCheck.id, window),
        ),
      )
      .orderBy(desc(at), desc(philhealthEligibilityCheck.id))
      .limit(window.limit);
  }

  /** YAKAP registration answers when recorded: status, effective date and PhilHealth's reference. Source `yakap_registration`. */
  timelineYakapRegistrations(organizationId: string, patientId: string, window: TimelineWindow) {
    const at = philhealthYakapRegistration.recordedAt;
    return this.db
      .select({
        id: philhealthYakapRegistration.id,
        patientId: philhealthYakapRegistration.patientId,
        at: timelineInstant(at),
        facilityId: philhealthYakapRegistration.facilityId,
        status: philhealthYakapRegistration.status,
        effectiveDate: philhealthYakapRegistration.effectiveDate,
        externalReference: philhealthYakapRegistration.externalReference,
      })
      .from(philhealthYakapRegistration)
      .where(
        and(
          eq(philhealthYakapRegistration.organizationId, organizationId),
          filedAsPatient(philhealthYakapRegistration.patientId, patientId),
          timelineFacility(philhealthYakapRegistration.facilityId, window),
          timelineRange("yakap_registration", at, philhealthYakapRegistration.id, window),
        ),
      )
      .orderBy(desc(at), desc(philhealthYakapRegistration.id))
      .limit(window.limit);
  }
}
