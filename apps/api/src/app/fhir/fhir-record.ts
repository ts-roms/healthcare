import { Inject, Injectable } from "@nestjs/common";
import { CarePlanService } from "@healthcare/care-plan";
import { ClinicQueries } from "@healthcare/clinic";
import { type Actor, APP_CONFIG, type AppConfig } from "@healthcare/core";
import { DocumentRecordQueries } from "@healthcare/documents";
import type { FhirContext, PatientRecordSource } from "@healthcare/interoperability";
import { LabRecordQueries } from "@healthcare/laboratory";
import { OrganizationService } from "@healthcare/organization";
import { PatientRecordService } from "@healthcare/patient";
import { PrescriptionService } from "@healthcare/prescription";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Documents (and their content) are for callers who may read documents, as on the documents API. */
export const canReadDocuments = (actor: Actor) => actor.permissions.has("document.read");

/**
 * Composes one patient's record from the domains' read queries into the
 * interoperability layer's source model (libs/interoperability maps it to FHIR).
 * Laboratory results are the current released versions only (with the
 * reference laboratory that performed a send-out). Documents — and imported
 * document descriptions — are included only for a caller who may read
 * documents (`document.read`). External history comes from the clinic.
 */
@Injectable()
export class FhirRecordComposer {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly organizations: OrganizationService,
    private readonly patients: PatientRecordService,
    private readonly clinic: ClinicQueries,
    private readonly lab: LabRecordQueries,
    private readonly prescriptions: PrescriptionService,
    private readonly carePlans: CarePlanService,
    private readonly documents: DocumentRecordQueries,
  ) {}

  async context(organizationId: string, requestBaseUrl: string): Promise<FhirContext> {
    const organization = await this.organizations.getOrganization(organizationId);
    const baseUrl = this.config.FHIR_BASE_URL ?? requestBaseUrl;
    return {
      baseUrl,
      identifierBase: `${this.config.FHIR_IDENTIFIER_BASE ?? `${new URL(baseUrl).origin}/fhir/identifiers`}/${organization.code}`,
      organization: { id: organization.id, code: organization.code, name: organization.name },
      identifierSystems: this.config.FHIR_IDENTIFIER_SYSTEMS,
      codeSystems: this.config.FHIR_CODE_SYSTEMS,
    };
  }

  /** The patient's whole record. Throws NotFoundError for a patient outside the actor's organization. */
  async record(actor: Actor, patientId: string): Promise<PatientRecordSource> {
    const organizationId = actor.organizationId;
    const patient = await this.patients.getDetail(actor, patientId);
    const withDocuments = canReadDocuments(actor);
    const [clinic, labOrders, prescriptions, carePlans, facilities, documents, reportArchives] = await Promise.all([
      this.clinic.patientRecord(organizationId, patientId),
      this.lab.patientRecord(organizationId, patientId),
      this.prescriptions.allForPatient(organizationId, patientId),
      this.carePlans.allForPatient(organizationId, patientId),
      this.organizations.listFacilities(organizationId),
      withDocuments ? this.documents.patientRecord(organizationId, patientId) : null,
      withDocuments ? this.lab.reportArchives(organizationId, patientId) : [],
    ]);
    const reports = reportVersions(reportArchives, new Set(documents?.map((d) => d.id)));

    const practitionerIds = new Set<string>();
    const facilityIds = new Set<string>();
    for (const e of [...clinic.encounters, ...clinic.appointments]) {
      practitionerIds.add(e.practitionerId);
      facilityIds.add(e.facilityId);
    }
    for (const o of labOrders) if (o.orderingPractitionerId) practitionerIds.add(o.orderingPractitionerId);
    for (const p of prescriptions) practitionerIds.add(p.prescriberPractitionerId);
    for (const c of carePlans) if (c.authorPractitionerId) practitionerIds.add(c.authorPractitionerId);
    const practitioners = await this.clinic.practitioners(organizationId, [...practitionerIds]);

    return {
      patient: {
        id: patient.id,
        patientNumber: patient.patientNumber,
        familyName: patient.familyName,
        givenName: patient.givenName,
        middleName: patient.middleName,
        suffix: patient.suffix,
        sex: patient.sex,
        birthDate: patient.birthDate,
        civilStatus: patient.civilStatus,
        status: patient.status,
        deceasedAt: patient.deceasedAt,
        mergedIntoPatientId: patient.mergedIntoPatientId,
        updatedAt: patient.updatedAt,
        identifiers: patient.identifiers,
        contacts: patient.contacts,
        addresses: patient.addresses,
        emergencyContacts: patient.relationships
          .filter((r) => r.isEmergencyContact)
          .map((r) => ({ name: r.name, relationship: r.relationship, contactNumber: r.contactNumber })),
      },
      facilities: facilities.filter((f) => facilityIds.has(f.id)),
      practitioners,
      encounters: clinic.encounters.map((e) => ({
        id: e.id,
        facilityId: e.facilityId,
        practitionerId: e.practitionerId,
        modality: e.modality,
        status: e.status,
        visitTypeName: e.visitTypeName,
        chiefComplaint: e.chiefComplaint,
        startedAt: e.startedAt.toISOString(),
        completedAt: iso(e.completedAt),
        appointmentId: e.appointmentId,
      })),
      diagnoses: clinic.diagnoses.map((d) => ({ ...d, recordedAt: d.recordedAt.toISOString() })),
      allergies: clinic.allergies.map((a) => ({ ...a, recordedAt: a.recordedAt.toISOString() })),
      allergyReview: clinic.allergyReview
        ? { noKnownAllergies: clinic.allergyReview.noKnownAllergies, reviewedAt: clinic.allergyReview.reviewedAt.toISOString() }
        : null,
      vitals: clinic.vitals.map((v) => ({ ...v, measuredAt: v.measuredAt.toISOString() })),
      appointments: clinic.appointments.map((a) => ({
        id: a.id,
        facilityId: a.facilityId,
        practitionerId: a.practitionerId,
        practitionerName: a.practitionerName,
        visitTypeName: a.visitTypeName,
        modality: a.modality,
        status: a.status,
        startsAt: a.startsAt.toISOString(),
        endsAt: a.endsAt.toISOString(),
        reason: a.reason,
        cancellationReason: a.cancellationReason,
      })),
      labOrders: labOrders.map((o) => ({
        id: o.id,
        facilityId: o.facilityId,
        orderNumber: o.orderNumber,
        status: o.status,
        priority: o.priority,
        orderedAt: o.orderedAt.toISOString(),
        encounterId: o.encounterId,
        orderingPractitionerId: o.orderingPractitionerId,
        clinicalIndication: o.clinicalIndication,
        items: o.items.map((i) => ({
          id: i.id,
          testCode: i.testCode,
          testName: i.testName,
          loincCode: i.loincCode,
          status: i.status,
          result: i.result
            ? {
                id: i.result.id,
                versionNumber: i.result.versionNumber,
                resultType: i.result.resultType,
                valueNumeric: i.result.valueNumeric,
                valueText: i.result.valueText,
                valueCoded: i.result.valueCoded,
                unit: i.result.unit,
                flag: i.result.flag,
                refLow: i.result.refLow,
                refHigh: i.result.refHigh,
                refText: i.result.refText,
                comment: i.result.comment,
                collectedAt: iso(i.result.collectedAt),
                releasedAt: iso(i.result.releasedAt),
                performer: i.result.referenceLaboratory,
              }
            : null,
        })),
      })),
      prescriptions: prescriptions.map((p) => ({
        id: p.id,
        prescriptionNumber: p.prescriptionNumber,
        status: p.status,
        encounterId: p.encounterId,
        prescriberPractitionerId: p.prescriberPractitionerId,
        issuedAt: p.issuedAt.toISOString(),
        cancelledAt: iso(p.cancelledAt),
        items: p.items.map((i) => ({ ...i, asNeeded: i.frequency === "as_needed" })),
      })),
      carePlans: carePlans.map((c) => ({
        id: c.id,
        title: c.title,
        category: c.category,
        status: c.status,
        description: c.description,
        startDate: c.startDate,
        endDate: c.endDate,
        authorPractitionerId: c.authorPractitionerId,
        createdAt: c.createdAt.toISOString(),
        activities: c.activities.map((a) => ({ id: a.id, kind: a.kind, description: a.description, status: a.status, dueDate: a.dueDate })),
      })),
      documents:
        documents?.map((d) => ({
          id: d.id,
          category: d.category,
          title: d.title,
          fileName: d.fileName,
          contentType: d.contentType,
          sizeBytes: d.sizeBytes,
          uploadedAt: d.uploadedAt.toISOString(),
          supersededAt: iso(reports.get(d.id)?.supersededAt),
          replaces: reports.get(d.id)?.replaces ?? [],
          related: reports.has(d.id) ? [{ type: "DiagnosticReport", id: reports.get(d.id)!.orderId }] : [],
        })) ?? null,
      externalHistory: clinic.externalHistory.map((e) => ({
        ...e,
        recordedAt: e.recordedAt.toISOString(),
        enteredInErrorAt: iso(e.enteredInErrorAt),
      })),
    };
  }
}

/**
 * Archived laboratory reports as document versions: each belongs to its order's DiagnosticReport; every version but
 * the latest is superseded when the next one was stored (stored archives never change, so this time is reliable), and
 * a version replaces the previous one when that one is exported too.
 */
function reportVersions(
  archives: Array<{ orderId: string; documentId: string; archiveVersion: number; storedAt: Date }>,
  exported: Set<string>,
): Map<string, { orderId: string; supersededAt: Date | null; replaces: string[] }> {
  const out = new Map<string, { orderId: string; supersededAt: Date | null; replaces: string[] }>();
  archives.forEach((a, i) => {
    const next = archives[i + 1]?.orderId === a.orderId ? archives[i + 1] : undefined;
    const previous = archives[i - 1]?.orderId === a.orderId ? archives[i - 1] : undefined;
    out.set(a.documentId, {
      orderId: a.orderId,
      supersededAt: next?.storedAt ?? null,
      replaces: previous && exported.has(previous.documentId) ? [previous.documentId] : [],
    });
  });
  return out;
}
