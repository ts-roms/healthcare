import { Inject, Injectable, Module } from "@nestjs/common";
import { DATABASE, type Database } from "@healthcare/core";
import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { billingService, billingServicePrice, type ServiceSourceKind, type TaxClass } from "../billing.schema";

/** A service's listed price on a date, as other domains may read it (estimates). */
export interface ListedPrice {
  sourceCode: string;
  serviceCode: string;
  serviceName: string;
  /** Centavos, as on the price list (VAT-inclusive where VAT applies). */
  unitPrice: number;
  taxClass: TaxClass | null;
}

/**
 * The price list as read by other domains for estimates (e.g. a dental treatment plan): the active service mapped to
 * each source code — the same mapping charge capture uses — and its price on a local date. Nothing else: no packages,
 * discounts or payer coverage, which apply only when a charge is captured and invoiced.
 */
@Injectable()
export class BillingPriceQueries {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Listed prices by (lower-cased) source code; codes with no active service or no price on the date are left out. */
  async listedPrices(organizationId: string, sourceKind: ServiceSourceKind, sourceCodes: readonly string[], onDate: string): Promise<Map<string, ListedPrice>> {
    const codes = [...new Set(sourceCodes.map((c) => c.toLowerCase()))];
    if (!codes.length) return new Map();
    const rows = await this.db
      .select({
        sourceCode: billingService.sourceCode,
        serviceCode: billingService.code,
        serviceName: billingService.name,
        unitPrice: billingServicePrice.unitPrice,
        taxClass: billingService.taxClass,
      })
      .from(billingService)
      .innerJoin(billingServicePrice, eq(billingServicePrice.serviceId, billingService.id))
      .where(
        and(
          eq(billingService.organizationId, organizationId),
          eq(billingService.sourceKind, sourceKind),
          inArray(billingService.sourceCode, codes),
          eq(billingService.status, "active"),
          lte(billingServicePrice.effectiveFrom, onDate),
          or(isNull(billingServicePrice.effectiveUntil), gte(billingServicePrice.effectiveUntil, onDate)),
        ),
      );
    return new Map(rows.map((r) => [r.sourceCode!, { ...r, sourceCode: r.sourceCode! }]));
  }
}

/** Only the price read, for domains that estimate fees without depending on the billing module (which imports them). */
@Module({ providers: [BillingPriceQueries], exports: [BillingPriceQueries] })
export class BillingPricesModule {}
