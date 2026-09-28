import { Injectable } from "@nestjs/common";
import { InvoiceService } from "@healthcare/billing";
import { ClinicQueries } from "@healthcare/clinic";
import { NotFoundError } from "@healthcare/core";
import { PatientRecordService } from "@healthcare/patient";
import {
  type ClaimSourcePatient,
  type ClaimSources,
  PHILHEALTH_ECLAIMS_SYSTEM,
  type PhilHealthBillingSink,
  type PhilHealthClaimSources,
} from "@healthcare/philhealth";

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
