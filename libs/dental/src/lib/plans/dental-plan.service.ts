import { Inject, Injectable } from "@nestjs/common";
import { type AuditActor, AuditService, type PatientAuditContext } from "@healthcare/audit";
import {
  type Actor,
  asPgError,
  BusinessRuleError,
  ConflictError,
  DATABASE,
  type Database,
  type DbExecutor,
  DomainEventPublisher,
  NotFoundError,
  PgErrorCode,
  requireFacilityId,
  filedAsPatient,
  isFiledAs,
} from "@healthcare/core";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import { DentalCatalogService } from "../catalog/dental-catalog.service";
import type { addPlanItemSchema, createPlanSchema, decidePlanSchema } from "../dental.dto";
import { normalizeSurfaces, planStatusFromItems, procedureSiteIssues } from "../dental.rules";
import {
  dentalTreatmentPlan,
  dentalTreatmentPlanItem,
  dentalWrittenEstimate,
  type DentalTreatmentPlanItemRecord,
  type DentalTreatmentPlanRecord,
  type DentalProcedureRecord,
  type Surface,
} from "../dental.schema";
import { assertVersion, found, rejectIssues, requireDentist, strip } from "../dental-support";
import { DENTAL_CONTEXT, type DentalContext } from "../ports";
import { DentalPortalSettings } from "../portal/dental-portal-settings.service";
import { DentalFeeLookup, type ItemFee, itemFee } from "./dental-fee-lookup";
import { writtenEstimateCovers } from "./fee-estimate.rules";

type PlanItemInput = { phase: number; procedureTypeId: string; tooth?: string; surfaces: Surface[]; note?: string };

const OPEN: ReadonlySet<DentalTreatmentPlanRecord["status"]> = new Set(["proposed", "accepted", "in_progress"]);

/**
 * Dental treatment plans: phased items (procedure, tooth, surfaces) proposed by a dentist, accepted or declined by the
 * patient item by item, and completed by performed procedures. Fees come from billing when the procedure is charged;
 * the plan carries no prices of its own, only the estimate (billing's listed price) each item had when the patient
 * decided it (`DentalFeeEstimates`).
 */
@Injectable()
export class DentalPlanService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
    private readonly catalog: DentalCatalogService,
    @Inject(DENTAL_CONTEXT) private readonly context: DentalContext,
    private readonly fees: DentalFeeLookup,
    private readonly settings: DentalPortalSettings,
  ) {}

  async create(actor: Actor, input: z.infer<typeof createPlanSchema>) {
    const dentist = await requireDentist(this.context, actor);
    const facilityId = requireFacilityId(actor);
    try {
      return await this.db.transaction(async (tx) => {
        await this.checkItems(tx, actor.organizationId, input.items);
        const [created] = await tx
          .insert(dentalTreatmentPlan)
          .values({
            organizationId: actor.organizationId,
            facilityId,
            patientId: input.patientId,
            practitionerId: dentist.id,
            title: input.title,
            notes: input.notes || null,
            createdBy: actor.userId,
          })
          .returning();
        const plan = found(created, "Treatment plan");
        await tx.insert(dentalTreatmentPlanItem).values(input.items.map((item) => this.itemValues(actor, plan.id, item)));
        await this.audit.record(tx, actor, {
          action: "dental.plan.create",
          resourceType: "dental_treatment_plan",
          resourceId: plan.id,
          patientId: plan.patientId,
          metadata: { items: input.items.length },
        });
        await this.events.record(tx, {
          type: "DentalTreatmentPlanCreated",
          organizationId: actor.organizationId,
          aggregateType: "dental_treatment_plan",
          aggregateId: plan.id,
          facilityId,
          patientId: plan.patientId,
          payload: { items: input.items.length },
        });
        return this.view(tx, plan);
      });
    } catch (error) {
      if (asPgError(error)?.code === PgErrorCode.foreignKeyViolation) throw new NotFoundError("Patient");
      throw error;
    }
  }

  async get(organizationId: string, planId: string) {
    return this.view(this.db, await this.find(this.db, organizationId, planId));
  }

  async forPatient(organizationId: string, patientId: string) {
    const plans = await this.db
      .select()
      .from(dentalTreatmentPlan)
      .where(and(eq(dentalTreatmentPlan.organizationId, organizationId), filedAsPatient(dentalTreatmentPlan.patientId, patientId)))
      .orderBy(desc(dentalTreatmentPlan.createdAt));
    const items = plans.length
      ? await this.db
          .select()
          .from(dentalTreatmentPlanItem)
          .where(
            inArray(
              dentalTreatmentPlanItem.planId,
              plans.map((p) => p.id),
            ),
          )
          .orderBy(asc(dentalTreatmentPlanItem.phase), asc(dentalTreatmentPlanItem.createdAt))
      : [];
    const types = await this.catalog.byIds(
      this.db,
      organizationId,
      items.map((i) => i.procedureTypeId),
    );
    return plans.map((p) => ({
      ...strip(p),
      items: items.filter((i) => i.planId === p.id).map((i) => itemView(i, types)),
    }));
  }

  /** Adds an item to an open plan; it awaits the patient's decision. */
  async addItem(actor: Actor, planId: string, input: z.infer<typeof addPlanItemSchema>) {
    await requireDentist(this.context, actor);
    return this.db.transaction(async (tx) => {
      const plan = await this.lock(tx, actor.organizationId, planId);
      assertVersion(plan.version, input.version, "Treatment plan");
      if (!OPEN.has(plan.status)) throw new BusinessRuleError("The plan is closed; start a new plan", "plan_closed");
      await this.checkItems(tx, actor.organizationId, [input]);
      const [item] = await tx
        .insert(dentalTreatmentPlanItem)
        .values(this.itemValues(actor, plan.id, input))
        .returning();
      const updated = await this.touch(tx, plan, {});
      await this.audit.record(tx, actor, {
        action: "dental.plan.item.add",
        resourceType: "dental_treatment_plan",
        resourceId: plan.id,
        patientId: plan.patientId,
        metadata: { itemId: item!.id },
      });
      await this.events.record(tx, {
        type: "DentalTreatmentPlanItemAdded",
        organizationId: actor.organizationId,
        aggregateType: "dental_treatment_plan",
        aggregateId: plan.id,
        facilityId: plan.facilityId,
        patientId: plan.patientId,
        payload: { itemId: item!.id },
      });
      return this.view(tx, updated);
    });
  }

  /**
   * Records the patient's decision on every item awaiting one, as told to staff: the listed items are accepted, the
   * others declined. A proposed plan becomes accepted (or declined when nothing was accepted).
   */
  async decide(actor: Actor, planId: string, input: z.infer<typeof decidePlanSchema>) {
    return this.db.transaction(async (tx) => {
      const plan = await this.lock(tx, actor.organizationId, planId);
      await this.requireWrittenEstimate(tx, plan);
      const updated = await this.applyDecision(tx, actor, plan, input, { channel: "in_person", decidedBy: actor.userId, decidedByPortalAccount: null });
      return this.view(tx, updated);
    });
  }

  /**
   * The patient's own decision in MyHealth, when the organization allows it (checked by the caller, which also passes
   * the organization's acknowledgement the patient confirmed — kept as the decision note). The same rules as a decision
   * recorded by staff; the plan must be the patient's own. Instead of the plan's version, the patient sends the items
   * that were awaiting their decision when they looked: if the dentist changed them since, nothing is decided.
   * Audited with the patient as the actor.
   */
  async decideByPatient(
    tx: DbExecutor,
    context: PatientAuditContext,
    planId: string,
    input: { acceptedItemIds: string[]; awaitingItemIds: string[]; acknowledgement: string },
  ): Promise<DentalTreatmentPlanRecord> {
    const plan = await this.lock(tx, context.organizationId, planId);
    // A plan filed under a record since merged into this one is still the patient's to decide.
    if (!(await isFiledAs(tx, plan.patientId, context.patientId))) throw new NotFoundError("Treatment plan");
    const awaiting = (await this.items(tx, plan.id)).filter((i) => i.status === "proposed").map((i) => i.id);
    const seen = new Set(input.awaitingItemIds);
    if (awaiting.length !== seen.size || awaiting.some((id) => !seen.has(id))) {
      throw new ConflictError("Your dentist changed this plan since you opened it. Please review it again.", undefined, "plan_changed");
    }
    return this.applyDecision(
      tx,
      context,
      plan,
      { acceptedItemIds: input.acceptedItemIds, note: input.acknowledgement, version: plan.version },
      { channel: "portal", decidedBy: null, decidedByPortalAccount: context.accountId },
    );
  }

  /**
   * When the organization requires it (its own setting, docs/domains/dental.md "Written estimates"), a decision recorded
   * by staff needs a signed written estimate that listed every item awaiting the decision and still holds today.
   */
  private async requireWrittenEstimate(tx: DbExecutor, plan: DentalTreatmentPlanRecord) {
    const { writtenRequired } = await this.settings.estimates(plan.organizationId, tx);
    if (!writtenRequired) return;
    const awaiting = (await this.items(tx, plan.id)).filter((i) => i.status === "proposed").map((i) => i.id);
    const written = await tx
      .select({ itemIds: dentalWrittenEstimate.itemIds, validUntil: dentalWrittenEstimate.validUntil })
      .from(dentalWrittenEstimate)
      .where(and(eq(dentalWrittenEstimate.organizationId, plan.organizationId), eq(dentalWrittenEstimate.planId, plan.id)));
    const today = await this.fees.today(plan.organizationId, plan.facilityId);
    if (awaiting.length && !writtenEstimateCovers(written, awaiting, today)) {
      throw new BusinessRuleError(
        "Record the patient's signed written estimate for the items awaiting a decision first (or print a new one if it expired or the plan changed)",
        "written_estimate_required",
      );
    }
  }

  /** Accepts the listed items awaiting a decision and declines the others, then updates, audits and announces the plan. */
  private async applyDecision(
    tx: DbExecutor,
    actor: AuditActor,
    plan: DentalTreatmentPlanRecord,
    input: { acceptedItemIds: string[]; note: string; version: number },
    by: { channel: "in_person" | "portal"; decidedBy: string | null; decidedByPortalAccount: string | null },
  ): Promise<DentalTreatmentPlanRecord> {
    assertVersion(plan.version, input.version, "Treatment plan");
    if (!OPEN.has(plan.status)) throw new BusinessRuleError("The plan is closed", "plan_closed");
    const items = await this.items(tx, plan.id);
    const awaiting = items.filter((i) => i.status === "proposed");
    if (!awaiting.length) throw new BusinessRuleError("No items are awaiting the patient's decision", "nothing_to_decide");
    const accepted = new Set(input.acceptedItemIds);
    const unknown = input.acceptedItemIds.filter((id) => !awaiting.some((i) => i.id === id));
    if (unknown.length) throw new BusinessRuleError("Only items awaiting a decision can be accepted", "item_not_proposed", { itemIds: unknown });
    // The estimate each item carries with the decision: billing's listed price today at the plan's facility.
    const priced = await this.fees.price(
      plan.organizationId,
      awaiting.map((i) => i.procedureTypeId),
      await this.fees.today(plan.organizationId, plan.facilityId),
      tx,
    );
    for (const item of awaiting) {
      await tx
        .update(dentalTreatmentPlanItem)
        .set({
          status: accepted.has(item.id) ? "accepted" : "declined",
          // The low end of the item's range (the listed price without one) and, with a range, its high end.
          decisionEstimate: decisionLow(itemFee(priced, item.procedureTypeId, item.surfaces.length)),
          decisionEstimateHigh: rangeHigh(itemFee(priced, item.procedureTypeId, item.surfaces.length)),
          decisionEstimateOn: priced.pricedOn,
          updatedAt: new Date(),
          version: sql`${dentalTreatmentPlanItem.version} + 1`,
        })
        .where(eq(dentalTreatmentPlanItem.id, item.id));
    }
    const statuses = items.map((i) => (i.status === "proposed" ? (accepted.has(i.id) ? "accepted" : "declined") : i.status));
    const updated = await this.touch(tx, plan, {
      status: planStatusFromItems(statuses),
      decisionNote: input.note,
      decidedAt: new Date(),
      decidedBy: by.decidedBy,
      decisionChannel: by.channel,
      decidedByPortalAccount: by.decidedByPortalAccount,
    });
    await this.audit.record(tx, actor, {
      action: "dental.plan.decide",
      resourceType: "dental_treatment_plan",
      resourceId: plan.id,
      patientId: plan.patientId,
      reason: input.note,
      changes: { status: { from: plan.status, to: updated.status } },
      metadata: {
        accepted: [...accepted],
        declined: awaiting.filter((i) => !accepted.has(i.id)).map((i) => i.id),
        channel: by.channel,
        estimatePricedOn: priced.pricedOn,
      },
    });
    if (accepted.size) {
      await this.events.record(tx, {
        type: "DentalTreatmentPlanAccepted",
        organizationId: plan.organizationId,
        aggregateType: "dental_treatment_plan",
        aggregateId: plan.id,
        facilityId: plan.facilityId,
        patientId: plan.patientId,
        payload: { acceptedItems: accepted.size, channel: by.channel },
      });
    }
    return updated;
  }

  /** Withdraws an item not yet carried out (proposed or accepted). */
  async cancelItem(actor: Actor, planId: string, itemId: string, version: number) {
    return this.db.transaction(async (tx) => {
      const plan = await this.lock(tx, actor.organizationId, planId);
      assertVersion(plan.version, version, "Treatment plan");
      if (!OPEN.has(plan.status)) throw new BusinessRuleError("The plan is closed", "plan_closed");
      const items = await this.items(tx, plan.id);
      const item = found(
        items.find((i) => i.id === itemId),
        "Plan item",
      );
      if (item.status !== "proposed" && item.status !== "accepted") throw new BusinessRuleError("Only open items can be cancelled", "item_not_open");
      const statuses = items.map((i) => (i.id === itemId ? "cancelled" : i.status));
      if (plan.status === "proposed" ? !statuses.includes("proposed") : planStatusFromItems(statuses) === "declined") {
        throw new BusinessRuleError("This is the plan's last open item; record the patient's decision or discontinue the plan instead", "last_item");
      }
      await tx
        .update(dentalTreatmentPlanItem)
        .set({ status: "cancelled", updatedAt: new Date(), version: sql`${dentalTreatmentPlanItem.version} + 1` })
        .where(eq(dentalTreatmentPlanItem.id, itemId));
      const updated = await this.touch(tx, plan, plan.status === "proposed" ? {} : { status: planStatusFromItems(statuses) });
      await this.audit.record(tx, actor, {
        action: "dental.plan.item.cancel",
        resourceType: "dental_treatment_plan",
        resourceId: plan.id,
        patientId: plan.patientId,
        metadata: { itemId },
      });
      return this.view(tx, updated);
    });
  }

  /** Stops an accepted plan; work not yet done is cancelled. Completed items and their procedures stay. */
  async discontinue(actor: Actor, planId: string, reason: string, version: number) {
    return this.db.transaction(async (tx) => {
      const plan = await this.lock(tx, actor.organizationId, planId);
      assertVersion(plan.version, version, "Treatment plan");
      if (plan.status !== "accepted" && plan.status !== "in_progress") {
        throw new BusinessRuleError(
          plan.status === "proposed" ? "Record the patient's decision instead (a plan declined in full)" : "The plan is closed",
          "plan_not_active",
        );
      }
      await tx
        .update(dentalTreatmentPlanItem)
        .set({ status: "cancelled", updatedAt: new Date(), version: sql`${dentalTreatmentPlanItem.version} + 1` })
        .where(and(eq(dentalTreatmentPlanItem.planId, plan.id), inArray(dentalTreatmentPlanItem.status, ["proposed", "accepted"])));
      const updated = await this.touch(tx, plan, { status: "discontinued", discontinuedReason: reason });
      await this.audit.record(tx, actor, {
        action: "dental.plan.discontinue",
        resourceType: "dental_treatment_plan",
        resourceId: plan.id,
        patientId: plan.patientId,
        reason,
        changes: { status: { from: plan.status, to: "discontinued" } },
      });
      return this.view(tx, updated);
    });
  }

  // ---- used by procedures (within their transaction) ----------------------------------------------

  /** Marks an accepted item done by a procedure of the same type, tooth and patient; the plan moves on. */
  async completeItem(tx: DbExecutor, procedure: DentalProcedureRecord): Promise<void> {
    const [current] = await tx
      .select()
      .from(dentalTreatmentPlanItem)
      .where(and(eq(dentalTreatmentPlanItem.organizationId, procedure.organizationId), eq(dentalTreatmentPlanItem.id, procedure.planItemId!)))
      .for("update");
    const item = found(current, "Plan item");
    const plan = await this.lock(tx, procedure.organizationId, item.planId);
    if (plan.patientId !== procedure.patientId) throw new NotFoundError("Plan item");
    if (item.status !== "accepted" || (plan.status !== "accepted" && plan.status !== "in_progress")) {
      throw new BusinessRuleError("Only an accepted item of an active plan can be carried out", "plan_item_not_accepted");
    }
    // The planned procedure or one it may turn out to be (the catalog's alternatives, as configured now).
    const sameProcedure =
      item.procedureTypeId === procedure.procedureTypeId ||
      ((await this.catalog.alternativesOf(tx, procedure.organizationId, [item.procedureTypeId])).get(item.procedureTypeId) ?? []).some(
        (a) => a.id === procedure.procedureTypeId,
      );
    if (!sameProcedure || (item.tooth ?? null) !== (procedure.tooth ?? null)) {
      throw new BusinessRuleError("The procedure does not match the planned item (procedure — or one it may turn out to be — and tooth)", "plan_item_mismatch");
    }
    await tx
      .update(dentalTreatmentPlanItem)
      .set({ status: "completed", procedureId: procedure.id, updatedAt: new Date(), version: sql`${dentalTreatmentPlanItem.version} + 1` })
      .where(eq(dentalTreatmentPlanItem.id, item.id));
    await this.refresh(tx, plan);
  }

  /** A procedure marked entered in error: its item is open again (or cancelled, if the plan was stopped meanwhile). */
  async reopenItem(tx: DbExecutor, organizationId: string, itemId: string): Promise<void> {
    const [item] = await tx
      .select()
      .from(dentalTreatmentPlanItem)
      .where(and(eq(dentalTreatmentPlanItem.organizationId, organizationId), eq(dentalTreatmentPlanItem.id, itemId)))
      .for("update");
    if (!item || item.status !== "completed") return;
    const plan = await this.lock(tx, organizationId, item.planId);
    await tx
      .update(dentalTreatmentPlanItem)
      .set({
        status: plan.status === "discontinued" ? "cancelled" : "accepted",
        procedureId: null,
        updatedAt: new Date(),
        version: sql`${dentalTreatmentPlanItem.version} + 1`,
      })
      .where(eq(dentalTreatmentPlanItem.id, itemId));
    if (plan.status !== "discontinued") await this.refresh(tx, plan);
  }

  // ---- internals ----------------------------------------------------------------------------------

  private async refresh(tx: DbExecutor, plan: DentalTreatmentPlanRecord): Promise<void> {
    const statuses = (await this.items(tx, plan.id)).map((i) => i.status);
    const status = planStatusFromItems(statuses);
    if (status !== plan.status) await this.touch(tx, plan, { status });
  }

  private async checkItems(tx: DbExecutor, organizationId: string, items: PlanItemInput[]): Promise<void> {
    const issues: Record<string, string[]> = {};
    for (const [index, item] of items.entries()) {
      const type = await this.catalog.requireActive(tx, organizationId, item.procedureTypeId);
      issues[`items.${index}`] = procedureSiteIssues(type.site, item.tooth, item.surfaces);
    }
    rejectIssues(issues, "Some plan items are not recorded correctly", "invalid_plan_item");
  }

  private itemValues(actor: Actor, planId: string, item: PlanItemInput) {
    return {
      organizationId: actor.organizationId,
      planId,
      phase: item.phase,
      procedureTypeId: item.procedureTypeId,
      tooth: item.tooth ?? null,
      surfaces: normalizeSurfaces(item.surfaces),
      note: item.note || null,
      createdBy: actor.userId,
    };
  }

  private items(executor: DbExecutor, planId: string) {
    return executor
      .select()
      .from(dentalTreatmentPlanItem)
      .where(eq(dentalTreatmentPlanItem.planId, planId))
      .orderBy(asc(dentalTreatmentPlanItem.phase), asc(dentalTreatmentPlanItem.createdAt));
  }

  private async touch(tx: DbExecutor, plan: DentalTreatmentPlanRecord, changes: Partial<DentalTreatmentPlanRecord>): Promise<DentalTreatmentPlanRecord> {
    const [row] = await tx
      .update(dentalTreatmentPlan)
      .set({ ...changes, updatedAt: new Date(), version: plan.version + 1 })
      .where(eq(dentalTreatmentPlan.id, plan.id))
      .returning();
    return row!;
  }

  private async find(executor: DbExecutor, organizationId: string, planId: string): Promise<DentalTreatmentPlanRecord> {
    const [row] = await executor
      .select()
      .from(dentalTreatmentPlan)
      .where(and(eq(dentalTreatmentPlan.organizationId, organizationId), eq(dentalTreatmentPlan.id, planId)));
    return found(row, "Treatment plan");
  }

  private async lock(tx: DbExecutor, organizationId: string, planId: string): Promise<DentalTreatmentPlanRecord> {
    const [row] = await tx
      .select()
      .from(dentalTreatmentPlan)
      .where(and(eq(dentalTreatmentPlan.organizationId, organizationId), eq(dentalTreatmentPlan.id, planId)))
      .for("update");
    return found(row, "Treatment plan");
  }

  private async view(executor: DbExecutor, plan: DentalTreatmentPlanRecord) {
    const items = await this.items(executor, plan.id);
    const types = await this.catalog.byIds(
      executor,
      plan.organizationId,
      items.map((i) => i.procedureTypeId),
    );
    return { ...strip(plan), items: items.map((i) => itemView(i, types)) };
  }
}

function itemView(item: DentalTreatmentPlanItemRecord, types: Map<string, { code: string; name: string; site: string }>) {
  const type = types.get(item.procedureTypeId);
  const { organizationId: _o, ...rest } = item;
  return { ...rest, procedure: type ? { code: type.code, name: type.name, site: type.site } : null };
}

/** The estimate an item records with a decision: the low end of its range, or its amount; null without a listed price. */
function decisionLow(fee: ItemFee | null): number | null {
  return fee ? (fee.range?.low ?? fee.amount) : null;
}

/** The high end of an item's fee range to record with a decision; null without a range (a single price or none). */
function rangeHigh(fee: ItemFee | null): number | null {
  return fee?.range && fee.range.high > fee.range.low ? fee.range.high : null;
}
