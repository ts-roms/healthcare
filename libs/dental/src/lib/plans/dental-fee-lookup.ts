import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database, type DbExecutor, localDate } from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { DentalCatalogService } from "../catalog/dental-catalog.service";
import { DENTAL_FEES, type DentalFees, type DentalListedFee } from "../ports";
import { feeRange, type FeeRange, surfaceQuantity } from "./fee-estimate.rules";

/** A procedure it may turn out to be, with its listed unit price and what it would come to for the item (null: no price). */
export interface FeeAlternative {
  code: string;
  name: string;
  unitPrice: number | null;
  /** The unit price times the item's surfaces when priced per surface; null without a price. */
  amount: number | null;
}

/** A planned item's fee range: over its procedure and the procedures it may turn out to be (with alternatives only). */
export interface ProcedureFee extends FeeRange {
  alternatives: FeeAlternative[];
  /** Alternatives without a listed price (left out of the range). */
  unpricedAlternatives: number;
}

/** What a plan item comes to at the listed prices: its procedure's price times the quantity billing would charge. */
export interface ItemFee<F extends ListedUnitPrice = DentalListedFee> {
  listed: F;
  /** Surfaces treated when the price is per surface (at least one), else 1. */
  quantity: number;
  amount: number;
  /** With procedures it may turn out to be: the range (each priced for this item); null otherwise. */
  range: ProcedureFee | null;
}

/** Listed prices for procedure types, priced on a facility's local date. */
export interface PricedProcedures {
  /** The facility-local date (YYYY-MM-DD) the prices were read for. */
  pricedOn: string;
  /** By procedure type id; types whose code has no listed price that day are left out. */
  byType: Map<string, DentalListedFee>;
  /** By procedure type id: the procedures it may turn out to be, with their listed prices (null: none). */
  alternatives: Map<string, Array<{ code: string; name: string; fee: DentalListedFee | null }>>;
}

/**
 * A plan item's fee at the listed prices (null when its procedure has no listed price): each price is per item or per
 * surface as billing charges it, so a per-surface procedure on three surfaces comes to three times its price.
 */
/** The part of a listed fee an item's amount depends on. */
export type ListedUnitPrice = Pick<DentalListedFee, "unitPrice" | "perSurface">;

export function itemFee<F extends ListedUnitPrice>(
  priced: {
    byType: ReadonlyMap<string, F>;
    alternatives: ReadonlyMap<string, ReadonlyArray<{ code: string; name: string; fee: ListedUnitPrice | null }>>;
  },
  procedureTypeId: string,
  surfaceCount: number,
): ItemFee<F> | null {
  const listed = priced.byType.get(procedureTypeId);
  if (!listed) return null;
  const quantity = surfaceQuantity(listed.perSurface, surfaceCount);
  const amount = listed.unitPrice * quantity;
  const others = (priced.alternatives.get(procedureTypeId) ?? []).map((a) => ({
    code: a.code,
    name: a.name,
    unitPrice: a.fee?.unitPrice ?? null,
    amount: a.fee ? a.fee.unitPrice * surfaceQuantity(a.fee.perSurface, surfaceCount) : null,
  }));
  const range = others.length
    ? feeRange(
        amount,
        others.map((o) => o.amount),
      )
    : null;
  return { listed, quantity, amount, range: range ? { ...range, alternatives: others } : null };
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
    // One after the other: `executor` may be the caller's transaction, a single connection.
    const types = await this.catalog.byIds(executor, organizationId, [...procedureTypeIds]);
    const alternatives = await this.catalog.alternativesOf(executor, organizationId, procedureTypeIds);
    const codes = new Set([...types.values()].map((t) => t.code));
    for (const list of alternatives.values()) for (const a of list) codes.add(a.code);
    const listed = await this.fees.listedFees(organizationId, [...codes], pricedOn);
    const priceOf = (code: string) => listed.get(code.toLowerCase()) ?? null;
    const byType = new Map<string, DentalListedFee>();
    const others = new Map<string, Array<{ code: string; name: string; fee: DentalListedFee | null }>>();
    for (const [id, type] of types) {
      const fee = priceOf(type.code);
      if (fee) byType.set(id, fee);
      const list = alternatives.get(id) ?? [];
      if (list.length)
        others.set(
          id,
          list.map((a) => ({ code: a.code, name: a.name, fee: priceOf(a.code) })),
        );
    }
    return { pricedOn, byType, alternatives: others };
  }
}
