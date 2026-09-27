import { type DynamicModule, Module, type ModuleMetadata, type Type } from "@nestjs/common";
import { OrganizationModule } from "@healthcare/organization";
import { BillingCatalogController, BillingController } from "./billing.controllers";
import { BillingCatalogService } from "./catalog/billing-catalog.service";
import { ChargeCapture } from "./charges/charge-capture";
import { ChargeService } from "./charges/charge.service";
import { CreditNoteService } from "./credit-notes/credit-note.service";
import { BillingDocuments } from "./documents/billing-documents";
import { InvoiceService } from "./invoices/invoice.service";
import { DepositService } from "./payments/deposit.service";
import { PaymentService } from "./payments/payment.service";
import { BILLING_PATIENTS, BILLING_SOURCES, type BillingPatientDirectory, type BillingSources } from "./ports";

export interface BillingModuleOptions {
  imports?: ModuleMetadata["imports"];
  sources: Type<BillingSources>;
  patients: Type<BillingPatientDirectory>;
}

/** Billing: services and prices, charges, invoices, discounts, payer coverage, payments and refunds, deposits, credit notes. */
@Module({})
export class BillingModule {
  static forRoot(options: BillingModuleOptions): DynamicModule {
    return {
      module: BillingModule,
      imports: [OrganizationModule, ...(options.imports ?? [])],
      controllers: [BillingCatalogController, BillingController],
      providers: [
        BillingCatalogService,
        BillingDocuments,
        ChargeCapture,
        ChargeService,
        CreditNoteService,
        DepositService,
        InvoiceService,
        PaymentService,
        { provide: BILLING_SOURCES, useClass: options.sources },
        { provide: BILLING_PATIENTS, useClass: options.patients },
      ],
      exports: [BillingDocuments, ChargeService, DepositService, InvoiceService],
    };
  }
}
