import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuditService } from "@healthcare/audit";
import { InvoiceService } from "@healthcare/billing";
import { Public } from "@healthcare/core";
import { CurrentPatient, PatientAccessGuard, patientAuditContext, type PortalPrincipal } from "@healthcare/patient";

/**
 * The patient's bills in MyHealth: issued (and voided) invoices with what is
 * covered, paid and still owed. Drafts are not shown. Paying online needs a
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
    private readonly audit: AuditService,
  ) {}

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
