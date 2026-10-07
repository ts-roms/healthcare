import { Inject, Injectable } from "@nestjs/common";
import { CarePlanService } from "@healthcare/care-plan";
import {
  canReadSensitiveHistory,
  ClinicProcedureService,
  ClinicQueries,
  ImmunizationService,
  medicationState,
  PatientHistoryService,
} from "@healthcare/clinic";
import { type Actor, APP_CONFIG, type AppConfig } from "@healthcare/core";
import { DentalRecordQueries } from "@healthcare/dental";
import { DocumentRecordQueries } from "@healthcare/documents";
import type { DentalImageSource, FhirContext, PatientRecordSource } from "@healthcare/interoperability";
import { LabRecordQueries } from "@healthcare/laboratory";
import { OrganizationService } from "@healthcare/organization";
import { PatientRecordService } from "@healthcare/patient";
import { PrescriptionService } from "@healthcare/prescription";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Documents (and their content) are for callers who may read documents, as on the documents API. */
export const canReadDocuments = (actor: Actor) => actor.permissions.has("document.read");

/** The dental record (procedures, treatment plans, chart, examinations, periodontal charts) is for callers who may read it, as on the dental API. */
export const canReadDental = (actor: Actor) => actor.permissions.has("dental.record.read");

/**
 * Composes one patient's record from the domains' read queries into the
 * interoperability layer's source model (libs/interoperability maps it to FHIR).
 * Laboratory results are the current released versions only (with the
 * reference laboratory that performed a send-out). Documents — and imported
 * document descriptions, and dental images' descriptions — are included only
 * for a caller who may read documents (`document.read`); the dental record only
 * for one who may read it (`dental.record.read`). External history comes from
 * the clinic, and so do the immunization history and the patient history (past procedures and conditions, family and
 * social history); substance use and sexual history only for a caller who may see them (history.read and
 * encounter.write).
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
    private readonly dental: DentalRecordQueries,
    private readonly immunizations: ImmunizationService,
    private readonly history: PatientHistoryService,
    private readonly procedures: ClinicProcedureService,
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

  /**
   * The patient's whole record. Throws NotFoundError for a patient outside the actor's organization. `include` overrides
   * the caller's own document and dental access for a workflow that has authorized it (a records office's copy of the
   * record, which answers the patient's own request).
   */
  async record(
    actor: Actor,
    patientId: string,
    include: { documents?: boolean; dental?: boolean; sensitiveHistory?: boolean } = {},
  ): Promise<PatientRecordSource> {
    const organizationId = actor.organizationId;
    const patient = await this.patients.getDetail(actor, patientId);
    const withDocuments = include.documents ?? canReadDocuments(actor);
    const withDental = include.dental ?? canReadDental(actor);
    const withSensitiveHistory = include.sensitiveHistory ?? canReadSensitiveHistory(actor.permissions);
    const [
      clinic,
      referrals,
      labOrders,
      prescriptions,
      carePlans,
      facilities,
      documents,
      reportArchives,
      dental,
      dentalImages,
      immunizations,
      history,
      clinicProcedures,
    ] = await Promise.all([
      this.clinic.patientRecord(organizationId, patientId),
      this.clinic.referralRecords(organizationId, patientId),
      this.lab.patientRecord(organizationId, patientId),
      this.prescriptions.allForPatient(organizationId, patientId),
      this.carePlans.allForPatient(organizationId, patientId),
      this.organizations.listFacilities(organizationId),
      withDocuments ? this.documents.patientRecord(organizationId, patientId) : null,
      withDocuments ? this.lab.reportArchives(organizationId, patientId) : [],
      withDental ? this.dental.patientRecord(organizationId, patientId) : null,
      // Dental images are documents: their descriptions go with the documents (document.read), like any document's metadata.
      withDocuments ? this.dental.images(organizationId, patientId) : [],
      this.immunizations.patientRecord(organizationId, patientId),
      this.history.patientRecord(organizationId, patientId),
      this.procedures.patientRecord(organizationId, patientId),
    ]);
    const reports = reportVersions(reportArchives, new Set(documents?.map((d) => d.id)));
    const images = new Map(dentalImages.map((i) => [i.documentId, i]));

    const practitionerIds = new Set<string>();
    const facilityIds = new Set<string>();
    for (const e of [...clinic.encounters, ...clinic.appointments]) {
      practitionerIds.add(e.practitionerId);
      facilityIds.add(e.facilityId);
    }
    for (const o of labOrders) if (o.orderingPractitionerId) practitionerIds.add(o.orderingPractitionerId);
    for (const p of prescriptions) practitionerIds.add(p.prescriberPractitionerId);
    for (const r of referrals) {
      practitionerIds.add(r.referringPractitionerId);
      if (r.toPractitionerId) practitionerIds.add(r.toPractitionerId);
    }
    for (const c of carePlans) if (c.authorPractitionerId) practitionerIds.add(c.authorPractitionerId);
    if (dental) {
      for (const r of [...dental.examinations, ...dental.procedures, ...dental.perioCharts]) {
        practitionerIds.add(r.practitionerId);
        facilityIds.add(r.facilityId);
      }
      for (const p of dental.plans) practitionerIds.add(p.practitionerId);
      for (const t of dental.chart) practitionerIds.add(t.practitionerId);
    }
    for (const i of immunizations) {
      if (i.performerPractitionerId) practitionerIds.add(i.performerPractitionerId);
      if (i.facilityId) facilityIds.add(i.facilityId);
    }
    for (const p of clinicProcedures) {
      practitionerIds.add(p.performerPractitionerId);
      facilityIds.add(p.facilityId);
    }
    for (const h of [...history.procedures, ...history.conditions, ...history.medications])
      if (h.recorderPractitionerId) practitionerIds.add(h.recorderPractitionerId);
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
        mergedRecordIds: patient.mergedRecords.map((r) => r.id),
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
      vitals: clinic.vitals.map((v) => ({
        ...v,
        measuredAt: v.measuredAt.toISOString(),
        recordedAt: v.recordedAt.toISOString(),
        enteredInErrorAt: iso(v.enteredInErrorAt),
      })),
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
      referrals: referrals.map((r) => ({
        id: r.id,
        referralNumber: r.referralNumber,
        kind: r.kind,
        status: r.status,
        urgency: r.urgency,
        encounterId: r.encounterId,
        referringPractitionerId: r.referringPractitionerId,
        toPractitionerId: r.toPractitionerId,
        externalProvider: r.externalProvider,
        externalFacility: r.externalFacility,
        externalContact: r.externalContact,
        specialty: r.specialty,
        reason: r.reason,
        clinicalSummary: r.clinicalSummary,
        diagnosisIds: r.diagnosisIds,
        issuedAt: r.issuedAt.toISOString(),
        replyDocumentId: r.replyDocumentId,
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
          dentalImage: dentalImage(images.get(d.id)),
        })) ?? null,
      externalHistory: clinic.externalHistory.map((e) => ({
        ...e,
        recordedAt: e.recordedAt.toISOString(),
        enteredInErrorAt: iso(e.enteredInErrorAt),
      })),
      dental: dental
        ? {
            examinations: dental.examinations.map((e) => ({ ...e, recordedAt: e.recordedAt.toISOString(), enteredInErrorAt: iso(e.enteredInErrorAt) })),
            procedures: dental.procedures.map((p) => ({ ...p, performedAt: p.performedAt.toISOString(), enteredInErrorAt: iso(p.enteredInErrorAt) })),
            plans: dental.plans.map((p) => ({ ...p, decidedAt: iso(p.decidedAt), createdAt: p.createdAt.toISOString() })),
            chart: dental.chart.map((t) => ({ ...t, recordedAt: t.recordedAt.toISOString() })),
            perioCharts: dental.perioCharts.map((c) => ({ ...c, recordedAt: c.recordedAt.toISOString(), enteredInErrorAt: iso(c.enteredInErrorAt) })),
          }
        : null,
      immunizations: immunizations.map((i) => ({
        id: i.id,
        source: i.source,
        status: i.status,
        notDoneReason: i.statusReason,
        notDoneReasonText: i.statusReasonText,
        vaccineName: i.vaccineName,
        vaccineCodeSystem: i.vaccineCodeSystem,
        vaccineCode: i.vaccineCode,
        vaccineManufacturer: i.vaccineManufacturer,
        doseLabel: i.doseLabel,
        doseNumber: i.doseNumber,
        occurrenceDate: i.occurrenceDate,
        occurrencePrecision: i.occurrencePrecision,
        occurredAt: iso(i.occurredAt),
        facilityId: i.facilityId,
        encounterId: i.encounterId,
        performerPractitionerId: i.performerPractitionerId,
        performerName: i.performerName,
        lotNumber: i.lotNumber,
        expiryDate: i.expiryDate,
        route: i.route,
        site: i.site,
        doseQuantity: i.doseQuantity,
        doseUnit: i.doseUnit,
        sourceDescription: i.sourceDescription,
        declaredSource: i.declaredSource,
        adverseReaction: i.adverseReaction,
        adverseReactionRecordedAt: iso(i.adverseReactionRecordedAt),
        recordedAt: i.recordedAt.toISOString(),
        enteredInErrorAt: iso(i.enteredInErrorAt),
      })),
      clinicProcedures: clinicProcedures.map((p) => ({
        id: p.id,
        encounterId: p.encounterId,
        facilityId: p.facilityId,
        code: p.code,
        name: p.name,
        codeSystem: p.codeSystem,
        externalCode: p.externalCode,
        performedAt: p.performedAt.toISOString(),
        performerPractitionerId: p.performerPractitionerId,
        bodySite: p.bodySite,
        quantity: p.quantity,
        recordedAt: p.recordedAt.toISOString(),
        enteredInErrorAt: iso(p.enteredInErrorAt),
      })),
      history: {
        sensitiveIncluded: withSensitiveHistory,
        procedures: history.procedures.map((p) => ({
          id: p.id,
          source: p.source,
          reportedBy: p.reportedBy,
          description: p.description,
          codeSystem: p.codeSystem,
          code: p.code,
          performedDate: p.performedDate,
          performedPrecision: p.performedPrecision,
          performer: p.performer,
          bodySite: p.bodySite,
          sourceDescription: p.sourceDescription,
          declaredSource: p.declaredSource,
          recorderPractitionerId: p.recorderPractitionerId,
          recordedAt: p.recordedAt.toISOString(),
          enteredInErrorAt: iso(p.enteredInErrorAt),
        })),
        conditions: history.conditions.map((c) => ({
          id: c.id,
          source: c.source,
          reportedBy: c.reportedBy,
          description: c.description,
          codeSystem: c.codeSystem,
          code: c.code,
          onsetDate: c.onsetDate,
          onsetPrecision: c.onsetPrecision,
          reportedStatus: c.reportedStatus,
          diagnosedBy: c.diagnosedBy,
          sourceDescription: c.sourceDescription,
          recorderPractitionerId: c.recorderPractitionerId,
          recordedAt: c.recordedAt.toISOString(),
          enteredInErrorAt: iso(c.enteredInErrorAt),
        })),
        medications: history.medications.map((m) => ({
          id: m.id,
          source: m.source,
          reportedBy: m.reportedBy,
          medication: m.medication,
          codeSystem: m.codeSystem,
          code: m.code,
          dose: m.doseText,
          reason: m.reason,
          prescribedBy: m.prescribedBy,
          startedDate: m.startedDate,
          startedPrecision: m.startedPrecision,
          status: medicationState(m),
          stoppedDate: m.stoppedDate,
          stoppedPrecision: m.stoppedPrecision,
          sourceDescription: m.sourceDescription,
          recorderPractitionerId: m.recorderPractitionerId,
          recordedAt: m.recordedAt.toISOString(),
          stopRecordedAt: iso(m.stopRecordedAt),
          enteredInErrorAt: iso(m.enteredInErrorAt),
        })),
        family: history.family.map((f) => ({
          id: f.id,
          source: f.source,
          relationship: f.relationship,
          relationshipText: f.relationshipText,
          condition: f.condition,
          codeSystem: f.codeSystem,
          code: f.code,
          onsetAge: f.onsetAge,
          deceased: f.deceased,
          causeOfDeath: f.causeOfDeath,
          declaredSource: f.declaredSource,
          recordedAt: f.recordedAt.toISOString(),
          enteredInErrorAt: iso(f.enteredInErrorAt),
        })),
        familyReview: history.familyReviews[0]
          ? {
              outcome: history.familyReviews[0].outcome,
              unknownReason: history.familyReviews[0].unknownReason,
              reviewedAt: history.familyReviews[0].reviewedAt.toISOString(),
            }
          : null,
        social: history.social.map((v) => ({
          id: v.id,
          effectiveDate: v.effectiveDate,
          tobaccoStatus: v.tobaccoStatus,
          tobaccoType: v.tobaccoType,
          tobaccoAmount: v.tobaccoAmount,
          tobaccoQuitYear: v.tobaccoQuitYear,
          alcoholStatus: v.alcoholStatus,
          alcoholFrequency: v.alcoholFrequency,
          substanceUse: withSensitiveHistory ? v.substanceUse : null,
          occupation: v.occupation,
          occupationalExposures: v.occupationalExposures,
          livingSituation: v.livingSituation,
          physicalActivity: v.physicalActivity,
          diet: v.diet,
          sexualHistory: withSensitiveHistory ? v.sexualHistory : null,
          recordedAt: v.recordedAt.toISOString(),
          enteredInErrorAt: iso(v.enteredInErrorAt),
        })),
      },
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

/** A dental image's description of its document, in the interoperability layer's terms. */
function dentalImage(
  image:
    | {
        id: string;
        kind: string;
        teeth: string[];
        takenOn: string;
        encounterId: string | null;
        status: DentalImageSource["status"];
        recordedAt: Date;
        enteredInErrorAt: Date | null;
      }
    | undefined,
): DentalImageSource | null {
  if (!image) return null;
  return {
    id: image.id,
    kind: image.kind,
    teeth: image.teeth,
    takenOn: image.takenOn,
    encounterId: image.encounterId,
    status: image.status,
    recordedAt: image.recordedAt.toISOString(),
    enteredInErrorAt: iso(image.enteredInErrorAt),
  };
}
