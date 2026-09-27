import { Controller, Get, Param, ParseUUIDPipe, StreamableFile, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuditService } from "@healthcare/audit";
import { BillingDocuments, DepositService, InvoiceService } from "@healthcare/billing";
import { pdfFile, Public } from "@healthcare/core";
import { CurrentPatient, PatientAccessGuard, patientAuditContext, type PortalPrincipal } from "@healthcare/patient";

/**
 * The patient's bills in MyHealth: issued (and voided) invoices with what is
 * covered, paid, credited and still owed, and their deposit and credit
 * balance (read only). Drafts are not shown. Paying online needs a
 * payment provider (an integration dependency); for now patients pay at the clinic.
 */
@ApiTags("portal")
@ApiBearerAuth()
@Public()
@UseGuards(PatientAccessGuard)
@Controller({ path: "portal/billing", version: "1" })
export class PortalBillingController {
  constructor(
    private readonly invoices: InvoiceService,
    private readonly deposits: DepositService,
    private readonly documents: BillingDocuments,
    private readonly audit: AuditService,
  ) {}

  @Get("account")
  @ApiOperation({ summary: "The patient's deposit and credit balance per facility, with its ledger" })
  async account(@CurrentPatient() patient: PortalPrincipal) {
    const accounts = await this.deposits.patientAccounts(patient.organizationId, patient.patientId);
    await this.audit.recordStandalone(patientAuditContext(patient), {
      action: "portal.billing-account-view",
      resourceType: "billing_account_entry",
      patientId: patient.patientId,
      metadata: { facilities: accounts.length },
    });
    return accounts;
  }

  @Get("credit-notes/:creditNoteId/pdf")
  @ApiOperation({ summary: "The patient's copy of a credit note (PDF)" })
  async creditNotePdf(@CurrentPatient() patient: PortalPrincipal, @Param("creditNoteId", ParseUUIDPipe) creditNoteId: string): Promise<StreamableFile> {
    const { filename, pdf } = await this.documents.patientCreditNotePdf(patient.organizationId, patient.patientId, creditNoteId, patientAuditContext(patient));
    return pdfFile(pdf, filename);
  }

  @Get(":invoiceId/pdf")
  @ApiOperation({ summary: "The patient's copy of an issued invoice (PDF)" })
  async pdf(@CurrentPatient() patient: PortalPrincipal, @Param("invoiceId", ParseUUIDPipe) invoiceId: string): Promise<StreamableFile> {
    const { filename, pdf } = await this.documents.patientInvoicePdf(patient.organizationId, patient.patientId, invoiceId, patientAuditContext(patient));
    return pdfFile(pdf, filename);
  }

  @Get()
  @ApiOperation({ summary: "The patient's invoices and balances" })
  async list(@CurrentPatient() patient: PortalPrincipal) {
    const invoices = await this.invoices.patientInvoices(patient.organizationId, patient.patientId);
    await this.audit.recordStandalone(patientAuditContext(patient), {
      action: "portal.billing-view",
      resourceType: "billing_invoice",
      patientId: patient.patientId,
      metadata: { count: invoices.length },
    });
    return invoices;
  }
}
