import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import type { Actor } from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { facilityLetterhead, pdfDate, pdfDateTime, pdfMoney, renderPdf } from "@healthcare/pdf";
import { DentalCatalogService } from "../catalog/dental-catalog.service";
import { normalizeSurfaces, toothInNotation } from "../dental.rules";
import type { PlanItemStatus, PlanStatus, Surface } from "../dental.schema";
import { DENTAL_CONTEXT, type DentalContext, type DentalListedFee } from "../ports";
import { DentalPortalSettings } from "../portal/dental-portal-settings.service";
import { DentalFeeLookup, itemFee, type ProcedureFee } from "./dental-fee-lookup";
import { DentalPlanService } from "./dental-plan.service";
import { ESTIMATE_DISCLAIMER, estimatePart, type EstimatePart, estimateTotals, type EstimateTotals } from "./fee-estimate.rules";

export interface DentalPlanEstimateItem {
  itemId: string;
  phase: number;
  tooth: string | null;
  surfaces: Surface[];
  procedure: { code: string; name: string } | null;
  status: PlanItemStatus;
  /** In the estimate (awaiting the patient's decision, or accepted and not yet done); null: not part of it. */
  part: EstimatePart | null;
  /** Billing's listed price today; null when the procedure has no listed price (or the item is not in the estimate). */
  listed: DentalListedFee | null;
  /** Surfaces charged when the price is per surface (at least one), else 1; null without a listed price. */
  quantity: number | null;
  /** The listed price times the quantity (centavos); null without a listed price. */
  amount: number | null;
  /**
   * With procedures it may turn out to be: the range of listed prices over it and them, and each of them with its
   * listed price. Null without alternatives, without a listed price, or when the item is not in the estimate.
   */
  range: ProcedureFee | null;
  /** The estimate recorded when the patient decided this item (null amount: no listed price then; high: its range's high end). */
  atDecision: { amount: number | null; high: number | null; pricedOn: string } | null;
}

export interface DentalPlanEstimate {
  planId: string;
  planStatus: PlanStatus;
  /** The facility-local date the listed prices are for. */
  pricedOn: string;
  currency: "PHP";
  items: DentalPlanEstimateItem[];
  totals: EstimateTotals;
  disclaimer: string;
  /** The organization's own note. */
  note: string | null;
}

/**
 * Fee estimates for treatment plans (docs/domains/dental.md, "Fee estimates"): the work still ahead on a plan at
 * billing's listed prices today, read through the `DentalFees` port. Dentistry keeps no prices; billing charges each
 * procedure when it is done. A printed estimate is audited (it is handed to the patient).
 */
@Injectable()
export class DentalFeeEstimates {
  constructor(
    private readonly plans: DentalPlanService,
    private readonly fees: DentalFeeLookup,
    private readonly catalog: DentalCatalogService,
    private readonly settings: DentalPortalSettings,
    private readonly organizations: OrganizationService,
    private readonly audit: AuditService,
    @Inject(DENTAL_CONTEXT) private readonly context: DentalContext,
  ) {}

  async forPlan(organizationId: string, planId: string): Promise<DentalPlanEstimate> {
    return (await this.load(organizationId, planId)).estimate;
  }

  async pdf(actor: Actor, planId: string): Promise<{ filename: string; pdf: Buffer }> {
    const { plan, estimate } = await this.load(actor.organizationId, planId);
    const [organization, facility, notation, patients, dentists] = await Promise.all([
      this.organizations.getOrganization(actor.organizationId),
      this.organizations.getFacility(actor.organizationId, plan.facilityId),
      this.catalog.notation(actor.organizationId, plan.facilityId),
      this.context.patientBriefs(actor.organizationId, [plan.patientId]),
      this.context.practitionerNames(actor.organizationId, [plan.practitionerId]),
    ]);
    const patient = patients.get(plan.patientId);
    const dentist = dentists.get(plan.practitionerId) ?? null;
    const lines = estimate.items.filter((i) => i.part);
    const pdf = await renderPdf(
      {
        title: "Treatment Plan Fee Estimate",
        letterhead: facilityLetterhead(organization.name, facility),
        printedAt: `Printed ${pdfDateTime(new Date(), facility.timezone)}`,
        footerNote: "This estimate is not an invoice or official receipt. Amounts in Philippine pesos (PHP).",
      },
      (w) => {
        w.fields([
          ["Patient", patient?.displayName ?? "Patient"],
          ["Patient number", patient?.patientNumber ?? ""],
          ["Treatment plan", plan.title],
          ["Dentist", dentist],
          ["Proposed on", pdfDate(plan.createdAt, facility.timezone)],
          ["Prices listed on", pdfDate(estimate.pricedOn)],
        ]);
        w.space();
        if (!lines.length) {
          w.paragraph("Nothing on this plan is awaiting a decision or still to be done.", { muted: true });
        } else {
          w.table(
            [
              { header: "Phase", width: 0.7, align: "center" },
              { header: "Tooth", width: 1.1 },
              { header: "Procedure", width: 3.2 },
              { header: "Status", width: 1.6 },
              { header: "Listed price", width: 1.9, align: "right" },
            ],
            lines.map((i) => [
              String(i.phase),
              i.tooth ? `${toothInNotation(i.tooth, notation)}${i.surfaces.length ? ` ${normalizeSurfaces(i.surfaces).join("")}` : ""}` : "Whole mouth",
              i.procedure?.name ?? "Dental procedure",
              i.part === "awaiting" ? "For your decision" : "Accepted",
              i.range
                ? moneyRange(i.range.low, i.range.high)
                : i.amount !== null && i.listed
                  ? i.quantity && i.quantity > 1
                    ? `${pdfMoney(i.amount)} (${i.quantity} surfaces at ${pdfMoney(i.listed.unitPrice)})`
                    : pdfMoney(i.amount)
                  : "Ask the clinic",
            ]),
          );
          w.space();
          w.totals([
            ["For your decision", moneyRange(estimate.totals.awaitingDecision, estimate.totals.awaitingDecisionHigh)],
            ["Accepted, not yet done", moneyRange(estimate.totals.accepted, estimate.totals.acceptedHigh)],
            ["Estimated total", moneyRange(estimate.totals.remaining, estimate.totals.remainingHigh), true],
          ]);
          const ranged = lines.filter((i) => i.range);
          if (ranged.length) {
            w.paragraph(
              `A range means the procedure may turn out to be another one once under way: ${ranged
                .map((i) => `${i.procedure?.name ?? "the procedure"} may become ${i.range!.alternatives.map((a) => a.name).join(" or ")}`)
                .join("; ")}. The procedure carried out is charged at its listed price.`,
              { muted: true },
            );
          }
          if (estimate.totals.unpricedItems) {
            w.paragraph(
              `${estimate.totals.unpricedItems} item${estimate.totals.unpricedItems === 1 ? " has" : "s have"} no listed price and ${estimate.totals.unpricedItems === 1 ? "is" : "are"} not in the total; ask the clinic.`,
              { bold: true },
            );
          }
        }
        w.space();
        w.paragraph(`Teeth are numbered in ${notation === "fdi" ? "FDI" : notation === "universal" ? "Universal" : "Palmer"} notation.`, { muted: true });
        w.paragraph(estimate.disclaimer, { muted: true });
        if (estimate.note) w.paragraph(estimate.note);
        w.signatures([
          { name: dentist ?? " ", role: "Dentist" },
          { name: patient?.displayName ?? " ", role: "Patient" },
        ]);
      },
    );
    await this.audit.recordStandalone(actor, {
      action: "dental.plan.estimate.print",
      resourceType: "dental_treatment_plan",
      resourceId: plan.id,
      patientId: plan.patientId,
      metadata: {
        pricedOn: estimate.pricedOn,
        remaining: estimate.totals.remaining,
        remainingHigh: estimate.totals.remainingHigh,
        unpricedItems: estimate.totals.unpricedItems,
      },
    });
    return { filename: `dental-estimate-${estimate.pricedOn}-${plan.id.slice(0, 8)}.pdf`, pdf };
  }

  private async load(organizationId: string, planId: string) {
    const plan = await this.plans.get(organizationId, planId);
    const pricedOn = await this.fees.today(organizationId, plan.facilityId);
    const included = plan.items.filter((i) => estimatePart(i.status));
    const [priced, settings] = await Promise.all([
      this.fees.price(
        organizationId,
        included.map((i) => i.procedureTypeId),
        pricedOn,
      ),
      this.settings.estimates(organizationId),
    ]);
    const items: DentalPlanEstimateItem[] = plan.items.map((i) => {
      const part = estimatePart(i.status);
      const fee = part ? itemFee(priced, i.procedureTypeId, i.surfaces.length) : null;
      return {
        itemId: i.id,
        phase: i.phase,
        tooth: i.tooth,
        surfaces: [...i.surfaces],
        procedure: i.procedure ? { code: i.procedure.code, name: i.procedure.name } : null,
        status: i.status,
        part,
        listed: fee?.listed ?? null,
        quantity: fee?.quantity ?? null,
        amount: fee?.amount ?? null,
        range: fee?.range ?? null,
        atDecision: i.decisionEstimateOn ? { amount: i.decisionEstimate, high: i.decisionEstimateHigh, pricedOn: i.decisionEstimateOn } : null,
      };
    });
    const estimate: DentalPlanEstimate = {
      planId: plan.id,
      planStatus: plan.status,
      pricedOn,
      currency: "PHP",
      items,
      totals: estimateTotals(
        items.map((i) => ({
          status: i.status,
          listedPrice: i.range ? i.range.low : i.amount,
          highPrice: i.range?.high ?? null,
        })),
      ),
      disclaimer: ESTIMATE_DISCLAIMER,
      note: settings.note,
    };
    return { plan, estimate };
  }
}

/** "PHP 800.00" or "PHP 800.00 to PHP 3,000.00" (the standard PDF fonts have no dash to rely on). */
function moneyRange(low: number, high: number): string {
  return high > low ? `${pdfMoney(low)} to ${pdfMoney(high)}` : pdfMoney(low);
}
