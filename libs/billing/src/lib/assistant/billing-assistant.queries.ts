import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database } from "@healthcare/core";
import { and, eq, inArray, lte } from "drizzle-orm";
import { billingCharge, billingService, billingServicePrice } from "../billing.schema";
import type { UnchargedKind } from "./uncharged-work.rules";

export interface ChargeStateQuery {
  kind: UnchargedKind;
  sourceId: string;
  code: string;
  /** YYYY-MM-DD */
  serviceDate: string;
}

export interface ChargeState {
  /** A charge (in any status) was captured for the source by the moment. */
  charged: boolean;
  mapped: boolean;
  priced: boolean;
}

/**
 * Billing's side of `billing.uncharged-work`: for clinical work the API hands it (ids, codes, days), whether billing
 * charged it and whether a priced service is mapped to its code. Billing's own tables only; it never reads the
 * clinical record. No patient data, so not audited here (the API audits the assistant request).
 */
@Injectable()
export class BillingAssistantQueries {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async chargeStates(organizationId: string, items: readonly ChargeStateQuery[], asOf: Date): Promise<Map<string, ChargeState>> {
    const result = new Map<string, ChargeState>();
    if (items.length === 0) return result;

    const charged = new Set<string>();
    for (const kind of ["clinic_procedure", "dental_procedure"] as const) {
      const ids = items.filter((i) => i.kind === kind).map((i) => i.sourceId);
      if (ids.length === 0) continue;
      const rows = await this.db
        .select({ sourceId: billingCharge.sourceId })
        .from(billingCharge)
        .where(
          and(
            eq(billingCharge.organizationId, organizationId),
            eq(billingCharge.sourceType, kind),
            inArray(billingCharge.sourceId, ids),
            lte(billingCharge.capturedAt, asOf),
          ),
        );
      for (const row of rows) if (row.sourceId) charged.add(`${kind}:${row.sourceId}`);
    }

    const codes = [...new Set(items.map((i) => i.code.toLowerCase()))];
    const services = await this.db
      .select({ id: billingService.id, sourceKind: billingService.sourceKind, sourceCode: billingService.sourceCode })
      .from(billingService)
      .where(and(eq(billingService.organizationId, organizationId), eq(billingService.status, "active"), inArray(billingService.sourceCode, codes)));
    const serviceFor = new Map(services.map((s) => [`${s.sourceKind}:${s.sourceCode}`, s.id]));
    const serviceIds = services.map((s) => s.id);
    const prices = serviceIds.length
      ? await this.db
          .select({ serviceId: billingServicePrice.serviceId, from: billingServicePrice.effectiveFrom, until: billingServicePrice.effectiveUntil })
          .from(billingServicePrice)
          .where(and(eq(billingServicePrice.organizationId, organizationId), inArray(billingServicePrice.serviceId, serviceIds)))
      : [];

    for (const item of items) {
      const serviceId = serviceFor.get(`${item.kind}:${item.code.toLowerCase()}`);
      const priced =
        serviceId !== undefined &&
        prices.some((p) => p.serviceId === serviceId && p.from <= item.serviceDate && (p.until === null || p.until >= item.serviceDate));
      result.set(`${item.kind}:${item.sourceId}`, { charged: charged.has(`${item.kind}:${item.sourceId}`), mapped: serviceId !== undefined, priced });
    }
    return result;
  }
}
