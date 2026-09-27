import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, StreamableFile } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, pdfFile, localDate, PH_TIMEZONE, RequireFacility, RequirePermissions } from "@healthcare/core";
import {
  AddPriceDto,
  ApplyDiscountDto,
  CancelChargeDto,
  CreateDiscountRuleDto,
  CreateInvoiceDto,
  CreatePayerDto,
  CreateServiceDto,
  DailyReportDto,
  IssueInvoiceDto,
  ListChargesDto,
  ListInvoicesDto,
  ManualChargeDto,
  PayerStatusDto,
  RecordPaymentDto,
  RefundDto,
  RemoveLineDto,
  SetPayerDto,
  UpdateServiceDto,
  UpdateSettingsDto,
  VoidInvoiceDto,
} from "./billing.dto";
import { BillingCatalogService } from "./catalog/billing-catalog.service";
import { ChargeService } from "./charges/charge.service";
import { BillingDocuments } from "./documents/billing-documents";
import { InvoiceService } from "./invoices/invoice.service";
import { PaymentService } from "./payments/payment.service";

/** Services and prices, payers, discount rules, document numbering. */
@ApiTags("billing")
@ApiBearerAuth()
@Controller({ path: "billing", version: "1" })
export class BillingCatalogController {
  constructor(private readonly catalog: BillingCatalogService) {}

  @Get("services")
  @RequirePermissions("billing.charge.read")
  services(@CurrentActor() actor: Actor) {
    return this.catalog.listServices(actor.organizationId, localDate(new Date(), PH_TIMEZONE));
  }

  @Post("services")
  @RequirePermissions("billing.pricelist.manage")
  @ApiOperation({ summary: "A billable service with its first price; optionally captured automatically for a visit type or laboratory test code" })
  createService(@CurrentActor() actor: Actor, @Body() body: CreateServiceDto) {
    return this.catalog.createService(actor, body);
  }

  @Patch("services/:serviceId")
  @RequirePermissions("billing.pricelist.manage")
  updateService(@CurrentActor() actor: Actor, @Param("serviceId", ParseUUIDPipe) id: string, @Body() body: UpdateServiceDto) {
    return this.catalog.updateService(actor, id, body);
  }

  @Post("services/:serviceId/prices")
  @RequirePermissions("billing.pricelist.manage")
  @ApiOperation({ summary: "A new price from a date (the current price ends the day before)" })
  addPrice(@CurrentActor() actor: Actor, @Param("serviceId", ParseUUIDPipe) id: string, @Body() body: AddPriceDto) {
    return this.catalog.addPrice(actor, id, body);
  }

  @Get("payers")
  @RequirePermissions("billing.charge.read")
  payers(@CurrentActor() actor: Actor) {
    return this.catalog.listPayers(actor.organizationId);
  }

  @Post("payers")
  @RequirePermissions("billing.pricelist.manage")
  createPayer(@CurrentActor() actor: Actor, @Body() body: CreatePayerDto) {
    return this.catalog.createPayer(actor, body);
  }

  @Get("discount-rules")
  @RequirePermissions("billing.charge.read")
  discountRules(@CurrentActor() actor: Actor) {
    return this.catalog.listDiscountRules(actor.organizationId);
  }

  @Post("discount-rules")
  @RequirePermissions("billing.pricelist.manage")
  @ApiOperation({ summary: "A discount rule (statutory ones need evidence; rates and coverage must be verified against current issuances)" })
  createDiscountRule(@CurrentActor() actor: Actor, @Body() body: CreateDiscountRuleDto) {
    return this.catalog.createDiscountRule(actor, body);
  }

  @Post("discount-rules/:ruleId/deactivate")
  @HttpCode(200)
  @RequirePermissions("billing.pricelist.manage")
  deactivateDiscountRule(@CurrentActor() actor: Actor, @Param("ruleId", ParseUUIDPipe) id: string) {
    return this.catalog.deactivateDiscountRule(actor, id);
  }

  @Get("settings")
  @RequirePermissions("billing.charge.read")
  settings(@CurrentActor() actor: Actor) {
    return this.catalog.settings(actor.organizationId);
  }

  @Put("settings")
  @RequirePermissions("billing.pricelist.manage")
  @ApiOperation({ summary: "Invoice and receipt number prefixes (format is a BIR compliance dependency)" })
  updateSettings(@CurrentActor() actor: Actor, @Body() body: UpdateSettingsDto) {
    return this.catalog.updateSettings(actor, body);
  }
}

/** Charges, invoices, payments and reports at the selected facility. */
@ApiTags("billing")
@ApiBearerAuth()
@RequireFacility()
@Controller({ path: "billing", version: "1" })
export class BillingController {
  constructor(
    private readonly charges: ChargeService,
    private readonly invoices: InvoiceService,
    private readonly payments: PaymentService,
    private readonly documents: BillingDocuments,
  ) {}

  @Get("worklist")
  @RequirePermissions("billing.charge.read")
  @ApiOperation({ summary: "Patients with charges not yet invoiced at this facility" })
  worklist(@CurrentActor() actor: Actor) {
    return this.charges.pendingByPatient(actor);
  }

  @Get("charges")
  @RequirePermissions("billing.charge.read")
  charges_(@CurrentActor() actor: Actor, @Query() query: ListChargesDto) {
    return this.charges.list(actor, query);
  }

  @Post("charges")
  @RequirePermissions("billing.charge.capture")
  @ApiOperation({ summary: "Add a charge by hand (a listed price, or another price with a reason)" })
  addCharge(@CurrentActor() actor: Actor, @Body() body: ManualChargeDto) {
    return this.charges.addManual(actor, body);
  }

  @Post("charges/:chargeId/cancel")
  @HttpCode(200)
  @RequirePermissions("billing.charge.capture")
  cancelCharge(@CurrentActor() actor: Actor, @Param("chargeId", ParseUUIDPipe) id: string, @Body() body: CancelChargeDto) {
    return this.charges.cancel(actor, id, body);
  }

  @Get("invoices")
  @RequirePermissions("billing.charge.read")
  invoices_(@CurrentActor() actor: Actor, @Query() query: ListInvoicesDto) {
    return this.invoices.list(actor, query);
  }

  @Post("invoices")
  @RequirePermissions("billing.invoice.issue")
  @ApiOperation({ summary: "A draft invoice from the patient's pending charges (all, or the ones given)" })
  createInvoice(@CurrentActor() actor: Actor, @Body() body: CreateInvoiceDto) {
    return this.invoices.createDraft(actor, body);
  }

  @Get("invoices/:invoiceId")
  @RequirePermissions("billing.charge.read")
  invoice(@CurrentActor() actor: Actor, @Param("invoiceId", ParseUUIDPipe) id: string) {
    return this.invoices.get(actor, id);
  }

  @Delete("invoices/:invoiceId/items/:itemId")
  @RequirePermissions("billing.invoice.issue")
  removeItem(
    @CurrentActor() actor: Actor,
    @Param("invoiceId", ParseUUIDPipe) id: string,
    @Param("itemId", ParseUUIDPipe) itemId: string,
    @Query() query: RemoveLineDto,
  ) {
    return this.invoices.removeItem(actor, id, itemId, query.version);
  }

  @Post("invoices/:invoiceId/discounts")
  @RequirePermissions("billing.discount.apply")
  applyDiscount(@CurrentActor() actor: Actor, @Param("invoiceId", ParseUUIDPipe) id: string, @Body() body: ApplyDiscountDto) {
    return this.invoices.applyDiscount(actor, id, body);
  }

  @Delete("invoices/:invoiceId/discounts/:discountId")
  @RequirePermissions("billing.discount.apply")
  removeDiscount(
    @CurrentActor() actor: Actor,
    @Param("invoiceId", ParseUUIDPipe) id: string,
    @Param("discountId", ParseUUIDPipe) discountId: string,
    @Query() query: RemoveLineDto,
  ) {
    return this.invoices.removeDiscount(actor, id, discountId, query.version);
  }

  @Post("invoices/:invoiceId/payers")
  @RequirePermissions("billing.invoice.issue")
  @ApiOperation({ summary: "Set what a payer (HMO, PhilHealth, insurer) covers, with the LOA or claim reference" })
  setPayer(@CurrentActor() actor: Actor, @Param("invoiceId", ParseUUIDPipe) id: string, @Body() body: SetPayerDto) {
    return this.invoices.setPayer(actor, id, body);
  }

  @Delete("invoices/:invoiceId/payers/:invoicePayerId")
  @RequirePermissions("billing.invoice.issue")
  removePayer(
    @CurrentActor() actor: Actor,
    @Param("invoiceId", ParseUUIDPipe) id: string,
    @Param("invoicePayerId", ParseUUIDPipe) payerId: string,
    @Query() query: RemoveLineDto,
  ) {
    return this.invoices.removePayer(actor, id, payerId, query.version);
  }

  @Post("invoices/:invoiceId/payers/:invoicePayerId/status")
  @HttpCode(200)
  @RequirePermissions("billing.invoice.issue")
  @ApiOperation({ summary: "Claim follow-up: submitted, settled (with amount) or denied" })
  payerStatus(
    @CurrentActor() actor: Actor,
    @Param("invoiceId", ParseUUIDPipe) id: string,
    @Param("invoicePayerId", ParseUUIDPipe) payerId: string,
    @Body() body: PayerStatusDto,
  ) {
    return this.invoices.updatePayerStatus(actor, id, payerId, body);
  }

  @Post("invoices/:invoiceId/discard")
  @HttpCode(204)
  @RequirePermissions("billing.invoice.issue")
  async discard(@CurrentActor() actor: Actor, @Param("invoiceId", ParseUUIDPipe) id: string, @Body() body: IssueInvoiceDto): Promise<void> {
    await this.invoices.discard(actor, id, body.version);
  }

  @Post("invoices/:invoiceId/issue")
  @HttpCode(200)
  @RequirePermissions("billing.invoice.issue")
  @ApiOperation({ summary: "Issue: numbers the invoice and makes it immutable" })
  issue(@CurrentActor() actor: Actor, @Param("invoiceId", ParseUUIDPipe) id: string, @Body() body: IssueInvoiceDto) {
    return this.invoices.issue(actor, id, body.version);
  }

  @Post("invoices/:invoiceId/void")
  @HttpCode(200)
  @RequirePermissions("billing.invoice.void")
  @ApiOperation({ summary: "Void an issued invoice (reason required; nothing may be paid); by default its charges go to a new draft" })
  void(@CurrentActor() actor: Actor, @Param("invoiceId", ParseUUIDPipe) id: string, @Body() body: VoidInvoiceDto) {
    return this.invoices.void(actor, id, body);
  }

  @Get("invoices/:invoiceId/pdf")
  @RequirePermissions("billing.charge.read")
  @ApiOperation({ summary: "Printable invoice (drafts watermarked DRAFT, voided ones VOID; audited)" })
  async invoicePdf(@CurrentActor() actor: Actor, @Param("invoiceId", ParseUUIDPipe) id: string): Promise<StreamableFile> {
    const { filename, pdf } = await this.documents.invoicePdf(actor, id);
    return pdfFile(pdf, filename);
  }

  @Get("payments/:paymentId/receipt.pdf")
  @RequirePermissions("billing.charge.read")
  @ApiOperation({ summary: "Printable acknowledgement receipt of a payment (audited)" })
  async receiptPdf(@CurrentActor() actor: Actor, @Param("paymentId", ParseUUIDPipe) id: string): Promise<StreamableFile> {
    const { filename, pdf } = await this.documents.receiptPdf(actor, id);
    return pdfFile(pdf, filename);
  }

  @Post("invoices/:invoiceId/payments")
  @RequirePermissions("billing.payment.record")
  @ApiOperation({ summary: "Record a patient payment (idempotent per key; no overpayment)" })
  pay(@CurrentActor() actor: Actor, @Param("invoiceId", ParseUUIDPipe) id: string, @Body() body: RecordPaymentDto) {
    return this.payments.record(actor, id, body);
  }

  @Post("payments/:paymentId/refund")
  @RequirePermissions("billing.refund.issue")
  @ApiOperation({ summary: "Refund all or part of a payment (reason required; idempotent per key)" })
  refund(@CurrentActor() actor: Actor, @Param("paymentId", ParseUUIDPipe) id: string, @Body() body: RefundDto) {
    return this.payments.refund(actor, id, body);
  }

  @Get("reports/daily")
  @RequirePermissions("billing.report.read")
  @ApiOperation({ summary: "The facility's day: invoices, discounts, collections by method, refunds, receivables" })
  daily(@CurrentActor() actor: Actor, @Query() query: DailyReportDto) {
    return this.payments.dailyReport(actor, query.date);
  }
}
