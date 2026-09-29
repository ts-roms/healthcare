import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database, type DbExecutor, localDate } from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { DentalCatalogService } from "../catalog/dental-catalog.service";
import { DENTAL_FEES, type DentalFees, type DentalListedFee } from "../ports";

/** Listed prices for procedure types, priced on a facility's local date. */
export interface PricedProcedures {
  /** The facility-local date (YYYY-MM-DD) the prices were read for. */
  pricedOn: string;
  /** By procedure type id; types whose code has no listed price that day are left out. */
  byType: Map<string, DentalListedFee>;
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
    const types = await this.catalog.byIds(executor, organizationId, [...procedureTypeIds]);
    const fees = await this.fees.listedFees(
      organizationId,
      [...types.values()].map((t) => t.code),
      pricedOn,
    );
    const byType = new Map<string, DentalListedFee>();
    for (const [id, type] of types) {
      const fee = fees.get(type.code.toLowerCase());
      if (fee) byType.set(id, fee);
    }
    return { pricedOn, byType };
  }
}
