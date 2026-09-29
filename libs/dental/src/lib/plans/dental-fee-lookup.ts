import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database, type DbExecutor, localDate } from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { DentalCatalogService } from "../catalog/dental-catalog.service";
import { DENTAL_FEES, type DentalFees, type DentalListedFee } from "../ports";
import { feeRange, type FeeRange } from "./fee-estimate.rules";

/** A procedure it may turn out to be, with its listed price (null: none). */
export interface FeeAlternative {
  code: string;
  name: string;
  unitPrice: number | null;
}

/** A planned procedure's fee: its range, and the alternatives behind it (empty: a single price). */
export interface ProcedureFee extends FeeRange {
  alternatives: FeeAlternative[];
  /** Alternatives without a listed price (left out of the range). */
  unpricedAlternatives: number;
}

/** Listed prices for procedure types, priced on a facility's local date. */
export interface PricedProcedures {
  /** The facility-local date (YYYY-MM-DD) the prices were read for. */
  pricedOn: string;
  /** By procedure type id; types whose code has no listed price that day are left out. */
  byType: Map<string, DentalListedFee>;
  /**
   * By procedure type id: the fee range over the procedure and the procedures it may turn out to be. Left out when the
   * procedure itself has no listed price.
   */
  fees: Map<string, ProcedureFee>;
}

/** Reads billing's listed prices (through the `DentalFees` port) for a plan's procedure types. */
@Injectable()
export class DentalFeeLookup {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(DENTAL_FEES) private readonly fees: DentalFees,
    private readonly catalog: DentalCatalogService,
    private readonly organizations: OrganizationService,
  ) {}

  /** Today at the facility (its time zone). */
  async today(organizationId: string, facilityId: string): Promise<string> {
    const facility = await this.organizations.getFacility(organizationId, facilityId);
    return localDate(new Date(), facility.timezone);
  }

  async price(organizationId: string, procedureTypeIds: readonly string[], pricedOn: string, executor: DbExecutor = this.db): Promise<PricedProcedures> {
    const [types, alternatives] = await Promise.all([
      this.catalog.byIds(executor, organizationId, [...procedureTypeIds]),
      this.catalog.alternativesOf(executor, organizationId, procedureTypeIds),
    ]);
    const codes = new Set([...types.values()].map((t) => t.code));
    for (const list of alternatives.values()) for (const a of list) codes.add(a.code);
    const listed = await this.fees.listedFees(organizationId, [...codes], pricedOn);
    const priceOf = (code: string) => listed.get(code.toLowerCase()) ?? null;
    const byType = new Map<string, DentalListedFee>();
    const fees = new Map<string, ProcedureFee>();
    for (const [id, type] of types) {
      const fee = priceOf(type.code);
      if (!fee) continue;
      byType.set(id, fee);
      const others = (alternatives.get(id) ?? []).map((a) => ({ code: a.code, name: a.name, unitPrice: priceOf(a.code)?.unitPrice ?? null }));
      const range = feeRange(
        fee.unitPrice,
        others.map((o) => o.unitPrice),
      );
      if (range) fees.set(id, { ...range, alternatives: others });
    }
    return { pricedOn, byType, fees };
  }
}
