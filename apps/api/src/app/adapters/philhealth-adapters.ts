import { Injectable } from "@nestjs/common";
import { InvoiceService } from "@healthcare/billing";
import { ClinicQueries } from "@healthcare/clinic";
import { localDate, NotFoundError } from "@healthcare/core";
import { LabRecordQueries } from "@healthcare/laboratory";
import { OrganizationService } from "@healthcare/organization";
import { PatientRecordService } from "@healthcare/patient";
import {
  type ClaimSourcePatient,
  type ClaimSources,
  PHILHEALTH_ECLAIMS_SYSTEM,
  type PhilHealthBillingSink,
  type PhilHealthClaimSources,
  type PhilHealthYakapSources,
  type YakapConsultation,
  type YakapEncounterSource,
} from "@healthcare/philhealth";
import { PrescriptionService } from "@healthcare/prescription";

/** PhilHealth claims → billing, patient and clinic: the invoice, the member's identity and the billed encounters' diagnoses. */
@Injectable()
export class AppPhilHealthClaimSources implements PhilHealthClaimSources {
  constructor(
    private readonly invoices: InvoiceService,
    private readonly patients: PatientRecordService,
    private readonly clinic: ClinicQueries,
  ) {}

  async forInvoice(organizationId: string, invoiceId: string): Promise<ClaimSources | undefined> {
    const invoice = await this.invoices.detail(organizationId, invoiceId).catch((error: unknown) => {
      if (error instanceof NotFoundError) return undefined;
      throw error;
    });
    if (!invoice) return undefined;
    const [sources, patient] = await Promise.all([
      this.invoices.itemSources(organizationId, invoiceId),
      this.patients.identity(organizationId, invoice.patientId, "philhealth_pin"),
    ]);
    if (!patient) return undefined;
    const sourceOf = new Map(sources.map((s) => [s.itemId, s]));
    const encounterIds = [...new Set(sources.filter((s) => s.sourceType === "encounter" && s.sourceId).map((s) => s.sourceId as string))];
    const diagnoses = await this.clinic.diagnosesForEncounters(organizationId, encounterIds);
    return {
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        issuedAt: invoice.issuedAt?.toISOString() ?? null,
        facilityId: invoice.facilityId,
        patientId: invoice.patientId,
        grossTotal: invoice.grossTotal,
        discountTotal: invoice.discountTotal,
        netTotal: invoice.netTotal,
        items: invoice.items.map((i) => ({
          description: i.description,
          category: i.category,
          serviceDate: i.serviceDate,
          quantity: i.quantity,
          grossAmount: i.grossAmount,
          discountAmount: i.discountAmount,
          netAmount: i.netAmount,
          sourceType: sourceOf.get(i.id)?.sourceType ?? "manual",
          sourceId: sourceOf.get(i.id)?.sourceId ?? null,
        })),
        payers: invoice.payers.map((p) => ({
          id: p.id,
          payerType: p.payerType,
          payerName: p.payerName,
          amount: p.amount,
          reference: p.reference,
          status: p.status,
        })),
      },
      patient: { ...patient, philhealthPin: patient.identifier },
      diagnoses: diagnoses.map((d) => ({
        encounterId: d.encounterId,
        codeSystemKey: d.codeSystemKey,
        code: d.code,
        display: d.display,
        rank: d.rank,
        status: d.status,
      })),
    };
  }

  async patient(organizationId: string, patientId: string): Promise<ClaimSourcePatient | undefined> {
    const identity = await this.patients.identity(organizationId, patientId, "philhealth_pin");
    if (!identity) return undefined;
    const { identifier, ...rest } = identity;
    return { ...rest, philhealthPin: identifier };
  }
}

/** PhilHealth claims → billing: record that PhilHealth acknowledged the claim. */
@Injectable()
export class AppPhilHealthBillingSink implements PhilHealthBillingSink {
  constructor(private readonly invoices: InvoiceService) {}

  claimSubmitted(input: { organizationId: string; invoiceId: string; invoicePayerId: string; reference: string; requestedBy: string }) {
    return this.invoices.recordIntegrationClaimSubmitted({ ...input, system: PHILHEALTH_ECLAIMS_SYSTEM });
  }
}

/**
 * PhilHealth YAKAP → clinic, prescriptions, laboratory and the patient record: one consultation with what it recorded
 * (coded diagnoses, prescriptions, laboratory orders — no notes, no results), and the patient's consultations.
 */
@Injectable()
export class AppPhilHealthYakapSources implements PhilHealthYakapSources {
  constructor(
    private readonly clinic: ClinicQueries,
    private readonly patients: PatientRecordService,
    private readonly prescriptions: PrescriptionService,
    private readonly lab: LabRecordQueries,
    private readonly organizations: OrganizationService,
  ) {}

  async encounter(organizationId: string, encounterId: string): Promise<YakapEncounterSource | undefined> {
    const row = await this.clinic.encounter(organizationId, encounterId);
    if (!row) return undefined;
    const [record, identity, prescriptions, labOrders, facility, [clinician]] = await Promise.all([
      this.clinic.patientRecord(organizationId, row.patientId),
      this.patients.identity(organizationId, row.patientId, "philhealth_pin"),
      this.prescriptions.allForPatient(organizationId, row.patientId),
      this.lab.patientRecord(organizationId, row.patientId),
      this.organizations.findFacility(organizationId, row.facilityId),
      this.clinic.practitioners(organizationId, [row.practitionerId]),
    ]);
    if (!identity || !facility) return undefined;
    const { identifier, ...patient } = identity;
    return {
      encounter: {
        id: row.id,
        patientId: row.patientId,
        facilityId: row.facilityId,
        facilityName: facility.name,
        date: localDate(row.startedAt, facility.timezone),
        startedAt: row.startedAt.toISOString(),
        completedAt: row.completedAt?.toISOString() ?? null,
        modality: row.modality,
        status: row.status,
        visitTypeName: record.encounters.find((e) => e.id === row.id)?.visitTypeName ?? null,
        clinician: clinician ? { name: clinician.displayName, profession: clinician.profession, licenseNumber: clinician.licenseNumber } : null,
      },
      patient: { ...patient, philhealthPin: identifier },
      diagnoses: record.diagnoses
        .filter((d) => d.encounterId === row.id)
        .map((d) => ({ codeSystemKey: d.codeSystemKey, code: d.code, display: d.display, rank: d.rank, certainty: d.certainty, status: d.status })),
      prescriptions: prescriptions
        .filter((p) => p.encounterId === row.id)
        .map((p) => ({
          prescriptionNumber: p.prescriptionNumber,
          status: p.status,
          issuedAt: p.issuedAt.toISOString(),
          items: p.items.map((i) => ({
            genericName: i.genericName,
            brandName: i.brandName,
            strength: i.strength,
            dosageForm: i.dosageForm,
            quantity: i.quantity,
            quantityUnit: i.quantityUnit,
          })),
        })),
      labOrders: labOrders
        .filter((o) => o.encounterId === row.id)
        .map((o) => ({
          orderNumber: o.orderNumber,
          status: o.status,
          orderedAt: o.orderedAt.toISOString(),
          tests: o.items.map((i) => ({ code: i.testCode, name: i.testName, loincCode: i.loincCode, status: i.status })),
        })),
    };
  }

  async consultations(organizationId: string, patientId: string): Promise<YakapConsultation[]> {
    const [record, facilities] = await Promise.all([this.clinic.patientRecord(organizationId, patientId), this.organizations.listFacilities(organizationId)]);
    const encounters = record.encounters
      .filter((e) => e.status !== "entered_in_error")
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, 50);
    const names = await this.clinic.practitionerNames(organizationId, [...new Set(encounters.map((e) => e.practitionerId))]);
    const facilityOf = new Map(facilities.map((f) => [f.id, f]));
    return encounters.map((e) => {
      const facility = facilityOf.get(e.facilityId);
      return {
        encounterId: e.id,
        facilityId: e.facilityId,
        facilityName: facility?.name ?? "",
        date: localDate(e.startedAt, facility?.timezone ?? "Asia/Manila"),
        modality: e.modality,
        status: e.status,
        visitTypeName: e.visitTypeName,
        clinicianName: names.get(e.practitionerId) ?? null,
      };
    });
  }
}
