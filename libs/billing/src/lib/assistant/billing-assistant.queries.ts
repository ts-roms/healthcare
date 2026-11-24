import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database } from "@healthcare/core";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { billingCharge, billingService, billingServicePrice } from "../billing.schema";
import type { InvoicePair } from "./duplicate-invoice.rules";
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

  /**
   * `billing.possible-duplicate-invoice`: pairs of the facility's invoices issued in the window and not void at the moment,
   * for the same patient (records merged into theirs included), with the same net total and the same services, issued
   * within `withinHours` of each other. Invoice numbers and totals only.
   */
  async duplicatePairs(organizationId: string, facilityId: string, window: { asOf: Date; lookbackDays: number; withinHours: number }): Promise<InvoicePair[]> {
    const asOf = window.asOf.toISOString();
    const since = new Date(window.asOf.getTime() - window.lookbackDays * 86_400_000).toISOString();
    const { rows } = await this.db.execute<{
      a_id: string;
      a_number: string;
      a_issued: string;
      b_id: string;
      b_number: string;
      b_issued: string;
      net_total: number;
      services: number;
    }>(sql`
      WITH inv AS (
        SELECT i.id, i.invoice_number, i.issued_at, i.net_total, patient_canonical_id(i.patient_id) AS patient,
               (SELECT array_agg(it.service_id::text ORDER BY it.service_id) FROM billing_invoice_item it WHERE it.invoice_id = i.id) AS services
        FROM billing_invoice i
        WHERE i.organization_id = ${organizationId}::uuid
          AND i.facility_id = ${facilityId}::uuid
          AND i.issued_at IS NOT NULL
          AND i.issued_at > ${since}::timestamptz AND i.issued_at <= ${asOf}::timestamptz
          AND (i.voided_at IS NULL OR i.voided_at > ${asOf}::timestamptz)
      )
      SELECT a.id AS a_id, a.invoice_number AS a_number, to_char(a.issued_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS a_issued,
             b.id AS b_id, b.invoice_number AS b_number, to_char(b.issued_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS b_issued,
             a.net_total::bigint AS net_total, coalesce(array_length(a.services, 1), 0) AS services
      FROM inv a
      JOIN inv b ON b.patient = a.patient AND b.net_total = a.net_total AND b.services IS NOT DISTINCT FROM a.services
               AND (b.issued_at > a.issued_at OR (b.issued_at = a.issued_at AND b.id > a.id))
               AND b.issued_at - a.issued_at <= make_interval(hours => ${window.withinHours})
      ORDER BY b.issued_at
    `);
    return rows.map((r) => ({
      first: { id: r.a_id, number: r.a_number, issuedAt: r.a_issued },
      second: { id: r.b_id, number: r.b_number, issuedAt: r.b_issued },
      netTotal: Number(r.net_total),
      services: Number(r.services),
    }));
  }
}
