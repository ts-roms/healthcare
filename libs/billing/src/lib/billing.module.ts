import { type DynamicModule, Module, type ModuleMetadata, type Provider, type Type } from "@nestjs/common";
import { OrganizationModule } from "@healthcare/organization";
import { BillingRecordQueries } from "./billing-record.queries";
import { BillingReportingQueries } from "./billing-reporting.queries";
import { BillingCatalogController, BillingController, OnlinePaymentNotificationController } from "./billing.controllers";
import { BillingCatalogService } from "./catalog/billing-catalog.service";
import { ChargeCapture } from "./charges/charge-capture";
import { ChargeService } from "./charges/charge.service";
import { CreditNoteService } from "./credit-notes/credit-note.service";
import { DebitNoteService } from "./credit-notes/debit-note.service";
import { BillingDocuments } from "./documents/billing-documents";
import { InvoiceService } from "./invoices/invoice.service";
import { PackageService } from "./packages/package.service";
import { DepositService } from "./payments/deposit.service";
import { OnlinePaymentService } from "./payments/online-payment.service";
import { paymentGatewayProvider } from "./payments/payment-gateway";
import { PaymentService } from "./payments/payment.service";
import { BILLING_PATIENTS, BILLING_SOURCES, type BillingPatientDirectory, type BillingSources } from "./ports";

export interface BillingModuleOptions {
  imports?: ModuleMetadata["imports"];
  sources: Type<BillingSources>;
  patients: Type<BillingPatientDirectory>;
  /** The payment provider adapter (PAYMENT_GATEWAY); unconfigured by default — no provider has been chosen. */
  paymentGateway?: Provider;
}

/** Billing: services and prices, charges, invoices, discounts, payer coverage, payments and refunds, deposits, credit notes. */
@Module({})
export class BillingModule {
  static forRoot(options: BillingModuleOptions): DynamicModule {
    return {
      module: BillingModule,
      imports: [OrganizationModule, ...(options.imports ?? [])],
      controllers: [BillingCatalogController, BillingController, OnlinePaymentNotificationController],
      providers: [
        BillingCatalogService,
        BillingDocuments,
        BillingRecordQueries,
        BillingReportingQueries,
        ChargeCapture,
        ChargeService,
        CreditNoteService,
        DebitNoteService,
        DepositService,
        InvoiceService,
        OnlinePaymentService,
        PackageService,
        PaymentService,
        options.paymentGateway ?? paymentGatewayProvider,
        { provide: BILLING_SOURCES, useClass: options.sources },
        { provide: BILLING_PATIENTS, useClass: options.patients },
      ],
      exports: [BillingDocuments, BillingRecordQueries, BillingReportingQueries, ChargeService, DepositService, InvoiceService, OnlinePaymentService],
    };
  }
}
