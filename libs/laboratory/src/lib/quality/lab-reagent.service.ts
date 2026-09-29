import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  type Actor,
  BadRequestError,
  BusinessRuleError,
  ConflictError,
  DATABASE,
  type Database,
  type DbExecutor,
  DomainEventPublisher,
  ForbiddenError,
  localDate,
  localDayBounds,
  NotFoundError,
  requireFacilityId,
} from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import {
  labInstrument,
  labQcRunReagent,
  labReagentLoad,
  type LabReagentLoadRecord,
  labReagentUse,
  labReagentLowAlert,
  labReagentYield,
  labResultReagent,
  labTest,
  type ReagentUseKind,
} from "../laboratory.schema";
import { found, publicView } from "../laboratory-support";
import { LABORATORY_CONTEXT, type LaboratoryContext } from "../ports";
import { costPerPatientRun, loadCapacity, type ReagentUseSummary, summarizeReagentUse } from "./reagent-use.rules";

/** Longest period the reagent use report reads at once, in days. */
export const MAX_REAGENT_USE_DAYS = 366;

/** Only inventory items of this category are loaded on instruments (and taken from stock when loading). */
export const REAGENT_CATEGORY = "reagent";

export type ReagentLoadView = Omit<LabReagentLoadRecord, "organizationId"> & {
  testName: string | null;
  instrumentName: string;
  loadedByName: string | null;
  unloadedByName: string | null;
  /** The lot's expiry date has passed (facility time zone). */
  expired: boolean;
  /** Runs counted against the load (all time) and what is left of its capacity. */
  use: ReagentUseSummary;
};

/** A reagent lot as recorded on a result or QC run. */
export interface RecordedReagent {
  loadId: string;
  itemCode: string;
  itemName: string;
  lotNumber: string | null;
  expiryDate: string | null;
}

/**
 * Reagent lots in use on instruments (Phase 9): the laboratory records which
 * inventory lot of a reagent is loaded on an instrument, for all its tests or
 * one test. Loading a new lot of the same reagent replaces the previous one;
 * the history stays. Results and QC runs record the lots in use when they
 * were entered, and an expired lot in use refuses both. Loading can take the
 * lot's stock from a storage location in the same transaction (through the
 * laboratory's port to inventory); otherwise stock is issued to the laboratory
 * separately.
 */
@Injectable()
export class LabReagentService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(LABORATORY_CONTEXT) private readonly context: LaboratoryContext,
    private readonly organizations: OrganizationService,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
  ) {}

  /** Lots currently loaded at the selected facility (optionally on one instrument). */
  async inUse(actor: Actor, instrumentId?: string): Promise<ReagentLoadView[]> {
    const facilityId = requireFacilityId(actor);
    const rows = await this.db
      .select()
      .from(labReagentLoad)
      .where(
        and(
          eq(labReagentLoad.organizationId, actor.organizationId),
          eq(labReagentLoad.facilityId, facilityId),
          isNull(labReagentLoad.unloadedAt),
          instrumentId ? eq(labReagentLoad.instrumentId, instrumentId) : undefined,
        ),
      )
      .orderBy(labReagentLoad.itemName);
    return this.views(actor.organizationId, facilityId, rows);
  }

  /** Every load on an instrument, newest first. */
  async history(actor: Actor, instrumentId: string): Promise<ReagentLoadView[]> {
    const instrument = await this.instrument(this.db, actor.organizationId, instrumentId);
    const rows = await this.db
      .select()
      .from(labReagentLoad)
      .where(eq(labReagentLoad.instrumentId, instrumentId))
      .orderBy(desc(labReagentLoad.loadedAt))
      .limit(200);
    return this.views(actor.organizationId, instrument.facilityId, rows);
  }

  /** Reagent lots with stock at the facility that can be loaded (not expired). */
  async available(actor: Actor) {
    const facilityId = requireFacilityId(actor);
    const today = await this.today(actor.organizationId, facilityId);
    const lots = await this.context.reagentLotsInStock(actor.organizationId, facilityId);
    return lots.filter((l) => l.itemStatus === "active" && !isExpired(l.expiryDate, today));
  }

  async load(
    actor: Actor,
    instrumentId: string,
    input: { inventoryLotId: string; testId?: string; takeFromStock?: { locationId: string; quantity: number }; capacityTests?: number },
  ): Promise<ReagentLoadView> {
    const facilityId = requireFacilityId(actor);
    if (input.takeFromStock && !actor.permissions.has("inventory.move")) throw new ForbiddenError("Taking stock needs the inventory.move permission");
    const lot = await this.context.inventoryLot(actor.organizationId, input.inventoryLotId);
    if (!lot) throw new NotFoundError("Inventory lot");
    if (lot.category !== REAGENT_CATEGORY) throw new BusinessRuleError("Only reagent lots are loaded on instruments", "not_a_reagent");
    if (lot.itemStatus !== "active") throw new BusinessRuleError("The reagent is inactive in inventory", "reagent_inactive");
    const today = await this.today(actor.organizationId, facilityId);
    if (isExpired(lot.expiryDate, today)) throw new BusinessRuleError("This reagent lot has expired", "reagent_lot_expired");
    const created = await this.db.transaction(async (tx) => {
      // Serializes loads per instrument, so "replace the lot in use" sees the current one.
      const instrument = await this.instrument(tx, actor.organizationId, instrumentId, true);
      if (instrument.facilityId !== facilityId) throw new BusinessRuleError("This instrument belongs to another facility", "wrong_facility");
      if (instrument.status === "retired") throw new BusinessRuleError("The instrument is retired", "instrument_retired");
      if (input.testId) {
        const [test] = await tx
          .select({ id: labTest.id })
          .from(labTest)
          .where(and(eq(labTest.organizationId, actor.organizationId), eq(labTest.id, input.testId)));
        found(test, "Laboratory test");
      }
      const now = new Date();
      const scope = input.testId ? eq(labReagentLoad.testId, input.testId) : isNull(labReagentLoad.testId);
      const [current] = await tx
        .select()
        .from(labReagentLoad)
        .where(and(eq(labReagentLoad.instrumentId, instrumentId), scope, eq(labReagentLoad.inventoryItemId, lot.itemId), isNull(labReagentLoad.unloadedAt)));
      if (current?.inventoryLotId === lot.lotId) throw new ConflictError("This lot is already loaded", undefined, "reagent_lot_loaded");
      if (current) {
        await tx
          .update(labReagentLoad)
          .set({ unloadedAt: now, unloadedBy: actor.userId, unloadReason: `Replaced by lot ${lot.lotNumber ?? "(no lot number)"}` })
          .where(eq(labReagentLoad.id, current.id));
      }
      const loadId = randomUUID();
      const [yieldRow] = await tx
        .select({ testsPerUnit: labReagentYield.testsPerUnit })
        .from(labReagentYield)
        .where(and(eq(labReagentYield.organizationId, actor.organizationId), eq(labReagentYield.inventoryItemId, lot.itemId)));
      const capacity = loadCapacity({ capacityTests: input.capacityTests, stockQuantity: input.takeFromStock?.quantity, testsPerUnit: yieldRow?.testsPerUnit });
      const stock = input.takeFromStock
        ? await this.context.takeReagentStock(tx, actor, {
            loadId,
            locationId: input.takeFromStock.locationId,
            itemId: lot.itemId,
            lotId: lot.lotId,
            quantity: input.takeFromStock.quantity,
            instrumentCode: instrument.code,
          })
        : null;
      const [row] = await tx
        .insert(labReagentLoad)
        .values({
          id: loadId,
          organizationId: actor.organizationId,
          facilityId,
          instrumentId,
          testId: input.testId ?? null,
          inventoryItemId: lot.itemId,
          inventoryLotId: lot.lotId,
          itemCode: lot.itemCode,
          itemName: lot.itemName,
          lotNumber: lot.lotNumber,
          expiryDate: lot.expiryDate,
          loadedAt: now,
          loadedBy: actor.userId,
          stockLocationId: input.takeFromStock?.locationId ?? null,
          stockQuantity: input.takeFromStock?.quantity ?? null,
          stockMovementGroupId: stock?.movementGroupId ?? null,
          capacityTests: capacity,
        })
        .returning();
      const load = found(row, "Reagent load");
      await this.audit.record(tx, actor, {
        action: "lab.reagent.load",
        resourceType: "lab_instrument",
        resourceId: instrumentId,
        metadata: {
          loadId: load.id,
          inventoryLotId: lot.lotId,
          itemCode: lot.itemCode,
          lotNumber: lot.lotNumber,
          testId: input.testId,
          replaces: current?.id,
          stockMovementGroupId: stock?.movementGroupId,
          capacityTests: capacity,
        },
      });
      await this.events.record(tx, {
        type: "LaboratoryReagentLotLoaded",
        organizationId: actor.organizationId,
        aggregateType: "lab_instrument",
        aggregateId: instrumentId,
        facilityId,
        payload: { loadId: load.id, inventoryLotId: lot.lotId, testId: input.testId ?? null, replaces: current?.id ?? null },
      });
      return load;
    });
    const [view] = await this.views(actor.organizationId, facilityId, [created]);
    return view!;
  }

  async unload(actor: Actor, loadId: string, reason: string): Promise<ReagentLoadView> {
    const facilityId = requireFacilityId(actor);
    const updated = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(labReagentLoad)
        .set({ unloadedAt: new Date(), unloadedBy: actor.userId, unloadReason: reason })
        .where(
          and(
            eq(labReagentLoad.organizationId, actor.organizationId),
            eq(labReagentLoad.facilityId, facilityId),
            eq(labReagentLoad.id, loadId),
            isNull(labReagentLoad.unloadedAt),
          ),
        )
        .returning();
      const load = found(row, "Loaded reagent lot");
      await this.audit.record(tx, actor, {
        action: "lab.reagent.unload",
        resourceType: "lab_instrument",
        resourceId: load.instrumentId,
        reason,
        metadata: { loadId },
      });
      await this.events.record(tx, {
        type: "LaboratoryReagentLotUnloaded",
        organizationId: actor.organizationId,
        aggregateType: "lab_instrument",
        aggregateId: load.instrumentId,
        facilityId,
        payload: { loadId },
      });
      return load;
    });
    const [view] = await this.views(actor.organizationId, facilityId, [updated]);
    return view!;
  }

  // ---- For results and QC runs ------------------------------------------------------------

  /**
   * The lots in use for a test on an instrument now (loaded for the test, or for every test on the instrument), and
   * when the newest of them was loaded. An expired lot in use refuses the work: load a new lot or unload it first.
   */
  async forUse(tx: DbExecutor, organizationId: string, facilityId: string, instrumentId: string, testId: string) {
    const loads = await this.current(tx, [instrumentId]);
    const applying = loads.filter((l) => l.testId === null || l.testId === testId);
    const today = await this.today(organizationId, facilityId);
    const expired = applying.find((l) => isExpired(l.expiryDate, today));
    if (expired) {
      throw new BusinessRuleError(
        `Reagent ${expired.itemName} lot ${expired.lotNumber ?? "(no lot number)"} loaded on this instrument has expired. Load a new lot first.`,
        "reagent_lot_expired",
      );
    }
    const latestChange = applying.reduce<Date | null>((latest, l) => (!latest || l.loadedAt > latest ? l.loadedAt : latest), null);
    return { loadIds: applying.map((l) => l.id), latestChange };
  }

  /** Current loads on these instruments (for the QC board). */
  current(executor: DbExecutor, instrumentIds: string[]): Promise<LabReagentLoadRecord[]> {
    if (instrumentIds.length === 0) return Promise.resolve([]);
    return executor
      .select()
      .from(labReagentLoad)
      .where(and(inArray(labReagentLoad.instrumentId, instrumentIds), isNull(labReagentLoad.unloadedAt)))
      .orderBy(labReagentLoad.itemName);
  }

  /**
   * Records the lots in use on a result and counts the run against each load: an order measured on the instrument,
   * once per load and result version (the tests of a panel entered for one order are one run).
   */
  async recordOnResult(
    tx: DbExecutor,
    organizationId: string,
    result: { id: string; orderId: string; versionNumber: number; enteredBy: string },
    loadIds: string[],
  ): Promise<void> {
    if (loadIds.length === 0) return;
    await tx.insert(labResultReagent).values(loadIds.map((reagentLoadId) => ({ organizationId, resultId: result.id, reagentLoadId })));
    const loads = await this.facilities(tx, loadIds);
    await tx
      .insert(labReagentUse)
      .values(
        loads.map((l) => ({
          organizationId,
          facilityId: l.facilityId,
          reagentLoadId: l.id,
          kind: "patient" as const,
          tests: 1,
          orderId: result.orderId,
          resultId: result.id,
          runNumber: result.versionNumber,
          recordedBy: result.enteredBy,
        })),
      )
      .onConflictDoNothing();
    await this.raiseLowAlerts(tx, organizationId, loadIds);
  }

  /** Records the lots in use on a QC run and counts the run against each load. */
  async recordOnQcRun(tx: DbExecutor, organizationId: string, run: { id: string; enteredBy: string }, loadIds: string[]): Promise<void> {
    if (loadIds.length === 0) return;
    await tx.insert(labQcRunReagent).values(loadIds.map((reagentLoadId) => ({ organizationId, qcRunId: run.id, reagentLoadId })));
    const loads = await this.facilities(tx, loadIds);
    await tx.insert(labReagentUse).values(
      loads.map((l) => ({
        organizationId,
        facilityId: l.facilityId,
        reagentLoadId: l.id,
        kind: "qc" as const,
        tests: 1,
        qcRunId: run.id,
        recordedBy: run.enteredBy,
      })),
    );
    await this.raiseLowAlerts(tx, organizationId, loadIds);
  }

  // ---- Use per run -------------------------------------------------------------------------

  /** Use recorded by staff on a loaded lot: repeats not entered as results, calibration, priming, waste, other. */
  async recordUse(actor: Actor, loadId: string, input: { kind: ReagentUseKind; tests: number; reason: string }): Promise<ReagentLoadView> {
    const facilityId = requireFacilityId(actor);
    if (input.kind === "patient" || input.kind === "qc") {
      throw new BusinessRuleError("Patient and QC runs are counted when results and QC runs are entered", "invalid_reagent_use");
    }
    const load = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(labReagentLoad)
        .where(and(eq(labReagentLoad.organizationId, actor.organizationId), eq(labReagentLoad.facilityId, facilityId), eq(labReagentLoad.id, loadId)))
        .for("update");
      const current = found(row, "Reagent load");
      if (current.unloadedAt) throw new ConflictError("This lot has been unloaded", undefined, "reagent_lot_unloaded");
      const [use] = await tx
        .insert(labReagentUse)
        .values({
          organizationId: actor.organizationId,
          facilityId,
          reagentLoadId: loadId,
          kind: input.kind,
          tests: input.tests,
          reason: input.reason,
          recordedBy: actor.userId,
        })
        .returning({ id: labReagentUse.id });
      await this.audit.record(tx, actor, {
        action: "lab.reagent.use",
        resourceType: "lab_instrument",
        resourceId: current.instrumentId,
        reason: input.reason,
        metadata: { loadId, useId: use?.id, kind: input.kind, tests: input.tests },
      });
      await this.events.record(tx, {
        type: "LaboratoryReagentUseRecorded",
        organizationId: actor.organizationId,
        aggregateType: "lab_instrument",
        aggregateId: current.instrumentId,
        facilityId,
        payload: { loadId, useId: use?.id ?? null, kind: input.kind, tests: input.tests },
      });
      await this.raiseLowAlerts(tx, actor.organizationId, [loadId]);
      return current;
    });
    const [view] = await this.views(actor.organizationId, facilityId, [load]);
    return view!;
  }

  /** Every use counted against a load, newest first (latest 500). */
  async uses(actor: Actor, loadId: string) {
    const [load] = await this.db
      .select()
      .from(labReagentLoad)
      .where(and(eq(labReagentLoad.organizationId, actor.organizationId), eq(labReagentLoad.id, loadId)));
    found(load, "Reagent load");
    const rows = await this.db
      .select()
      .from(labReagentUse)
      .where(eq(labReagentUse.reagentLoadId, loadId))
      .orderBy(desc(labReagentUse.recordedAt), desc(labReagentUse.id))
      .limit(500);
    const names = await this.context.staffNames(actor.organizationId, [...new Set(rows.map((r) => r.recordedBy))]);
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      tests: r.tests,
      orderId: r.orderId,
      resultId: r.resultId,
      runNumber: r.runNumber,
      qcRunId: r.qcRunId,
      reason: r.reason,
      recordedAt: r.recordedAt,
      recordedByName: names.get(r.recordedBy) ?? null,
    }));
  }

  /** Tests per stock unit of each reagent, as the laboratory configured them. */
  async yields(actor: Actor) {
    const rows = await this.db
      .select()
      .from(labReagentYield)
      .where(eq(labReagentYield.organizationId, actor.organizationId))
      .orderBy(asc(labReagentYield.itemName));
    const names = await this.context.staffNames(actor.organizationId, [...new Set(rows.map((r) => r.updatedBy))]);
    return rows.map((r) => ({ ...publicView(r), updatedByName: names.get(r.updatedBy) ?? null }));
  }

  /** Sets how many tests one stock unit of a reagent holds; used for the capacity of loads from now on. */
  async setYield(actor: Actor, itemId: string, testsPerUnit: number) {
    const item = await this.context.inventoryItem(actor.organizationId, itemId);
    if (!item) throw new NotFoundError("Inventory item");
    if (item.category !== REAGENT_CATEGORY) throw new BusinessRuleError("Only reagents have a yield", "not_a_reagent");
    await this.db.transaction(async (tx) => {
      const [previous] = await tx
        .select({ testsPerUnit: labReagentYield.testsPerUnit })
        .from(labReagentYield)
        .where(and(eq(labReagentYield.organizationId, actor.organizationId), eq(labReagentYield.inventoryItemId, itemId)))
        .for("update");
      const values = { itemCode: item.code, itemName: item.name, stockUnit: item.stockUnit, testsPerUnit, updatedAt: new Date(), updatedBy: actor.userId };
      await tx
        .insert(labReagentYield)
        .values({ organizationId: actor.organizationId, inventoryItemId: itemId, ...values })
        .onConflictDoUpdate({ target: [labReagentYield.organizationId, labReagentYield.inventoryItemId], set: values });
      await this.audit.record(tx, actor, {
        action: "lab.reagent.yield",
        resourceType: "inventory_item",
        resourceId: itemId,
        metadata: { testsPerUnit, previous: previous?.testsPerUnit ?? null },
      });
    });
    return (await this.yields(actor)).find((y) => y.inventoryItemId === itemId)!;
  }

  /**
   * Reagent use at the selected facility over a period of local days: every load in use during the period with the
   * runs counted in the period and over its life, what is left, and — for finished loads whose stock came from
   * inventory — the reagent cost per patient run; with totals per reagent.
   */
  async usage(actor: Actor, query: { from: string; to: string; instrumentId?: string }) {
    if (query.from > query.to) throw new BadRequestError("The period starts after it ends");
    const days = (Date.parse(`${query.to}T00:00:00Z`) - Date.parse(`${query.from}T00:00:00Z`)) / 86_400_000 + 1;
    if (days > MAX_REAGENT_USE_DAYS) throw new BadRequestError(`Choose at most ${MAX_REAGENT_USE_DAYS} days`);
    const facilityId = requireFacilityId(actor);
    const facility = await this.organizations.getFacility(actor.organizationId, facilityId);
    const start = localDayBounds(query.from, facility.timezone).start;
    const end = localDayBounds(query.to, facility.timezone).end;
    const loads = await this.db
      .select()
      .from(labReagentLoad)
      .where(
        and(
          eq(labReagentLoad.organizationId, actor.organizationId),
          eq(labReagentLoad.facilityId, facilityId),
          query.instrumentId ? eq(labReagentLoad.instrumentId, query.instrumentId) : undefined,
          lt(labReagentLoad.loadedAt, end),
          or(isNull(labReagentLoad.unloadedAt), gte(labReagentLoad.unloadedAt, start)),
        ),
      )
      .orderBy(asc(labReagentLoad.itemName), desc(labReagentLoad.loadedAt));
    const base = { from: query.from, to: query.to, timeZone: facility.timezone };
    if (loads.length === 0) return { ...base, loads: [], reagents: [] };
    const ids = loads.map((l) => l.id);
    const [views, inPeriod, costs] = await Promise.all([
      this.views(actor.organizationId, facilityId, loads),
      this.db
        .select({ loadId: labReagentUse.reagentLoadId, kind: labReagentUse.kind, tests: sql<number>`sum(${labReagentUse.tests})::int` })
        .from(labReagentUse)
        .where(and(inArray(labReagentUse.reagentLoadId, ids), gte(labReagentUse.recordedAt, start), lt(labReagentUse.recordedAt, end)))
        .groupBy(labReagentUse.reagentLoadId, labReagentUse.kind),
      this.context.reagentStockCosts(
        actor.organizationId,
        loads.map((l) => l.stockMovementGroupId).filter((id): id is string => !!id),
      ),
    ]);
    const rows = views.map((v) => {
      const period = summarizeReagentUse(
        inPeriod.filter((u) => u.loadId === v.id),
        null,
        false,
      );
      const cost = v.stockMovementGroupId ? (costs.get(v.stockMovementGroupId) ?? null) : null;
      return {
        ...v,
        period: { patientRuns: period.patientRuns, qcRuns: period.qcRuns, otherRuns: period.otherRuns, wasted: period.wasted, total: period.total },
        /** What the stock taken at the load cost (centavos); null when not taken from stock or not valued. */
        stockCost: cost,
        costPerPatientRun: costPerPatientRun(cost, v.use.patientRuns, v.unloadedAt !== null),
        /** Capacity left when the lot was unloaded (unused). */
        unusedAtUnload: v.unloadedAt !== null && v.use.remaining !== null ? Math.max(v.use.remaining, 0) : null,
      };
    });
    const byItem = new Map<
      string,
      { itemCode: string; itemName: string; loads: number; patientRuns: number; qcRuns: number; otherRuns: number; wasted: number }
    >();
    for (const r of rows) {
      const g = byItem.get(r.inventoryItemId) ?? { itemCode: r.itemCode, itemName: r.itemName, loads: 0, patientRuns: 0, qcRuns: 0, otherRuns: 0, wasted: 0 };
      byItem.set(r.inventoryItemId, {
        ...g,
        loads: g.loads + 1,
        patientRuns: g.patientRuns + r.period.patientRuns,
        qcRuns: g.qcRuns + r.period.qcRuns,
        otherRuns: g.otherRuns + r.period.otherRuns,
        wasted: g.wasted + r.period.wasted,
      });
    }
    return {
      ...base,
      loads: rows,
      /** Runs in the period per reagent; nonPatientShare = everything but patient runs over all runs. */
      reagents: [...byItem.entries()].map(([inventoryItemId, g]) => {
        const total = g.patientRuns + g.qcRuns + g.otherRuns + g.wasted;
        return { inventoryItemId, ...g, total, nonPatientShare: total > 0 ? (total - g.patientRuns) / total : null };
      }),
    };
  }

  /** The lots recorded on QC runs, by run id. */
  async onQcRuns(executor: DbExecutor, runIds: string[]): Promise<Map<string, RecordedReagent[]>> {
    const map = new Map<string, RecordedReagent[]>();
    if (runIds.length === 0) return map;
    const rows = await executor
      .select({ runId: labQcRunReagent.qcRunId, load: labReagentLoad })
      .from(labQcRunReagent)
      .innerJoin(labReagentLoad, eq(labReagentLoad.id, labQcRunReagent.reagentLoadId))
      .where(inArray(labQcRunReagent.qcRunId, runIds));
    for (const { runId, load } of rows) map.set(runId, [...(map.get(runId) ?? []), recorded(load)]);
    return map;
  }

  // ---- internals ------------------------------------------------------------------------

  private async views(organizationId: string, facilityId: string, rows: LabReagentLoadRecord[]): Promise<ReagentLoadView[]> {
    if (rows.length === 0) return [];
    const [today, instruments, tests, names, uses] = await Promise.all([
      this.today(organizationId, facilityId),
      this.db
        .select({ id: labInstrument.id, name: labInstrument.name })
        .from(labInstrument)
        .where(inArray(labInstrument.id, [...new Set(rows.map((r) => r.instrumentId))])),
      this.testNames(rows.map((r) => r.testId).filter((id): id is string => !!id)),
      this.context.staffNames(organizationId, [...new Set(rows.flatMap((r) => [r.loadedBy, r.unloadedBy]).filter((id): id is string => !!id))]),
      this.db
        .select({ loadId: labReagentUse.reagentLoadId, kind: labReagentUse.kind, tests: sql<number>`sum(${labReagentUse.tests})::int` })
        .from(labReagentUse)
        .where(
          inArray(
            labReagentUse.reagentLoadId,
            rows.map((r) => r.id),
          ),
        )
        .groupBy(labReagentUse.reagentLoadId, labReagentUse.kind),
    ]);
    return rows.map((r) => ({
      ...publicView(r),
      testName: r.testId ? (tests.get(r.testId) ?? null) : null,
      instrumentName: instruments.find((i) => i.id === r.instrumentId)?.name ?? "",
      loadedByName: names.get(r.loadedBy) ?? null,
      unloadedByName: r.unloadedBy ? (names.get(r.unloadedBy) ?? null) : null,
      expired: isExpired(r.expiryDate, today),
      use: summarizeReagentUse(
        uses.filter((u) => u.loadId === r.id),
        r.capacityTests,
        r.unloadedAt === null,
      ),
    }));
  }

  /**
   * Raises the low-reagent alert, once per load, for loaded lots with a capacity whose runs now leave a tenth of it or
   * less (inside the transaction that counted the run): recorded in lab_reagent_low_alert and published as
   * LaboratoryReagentLow for the quality managers.
   */
  private async raiseLowAlerts(tx: DbExecutor, organizationId: string, loadIds: string[]): Promise<void> {
    const loads = await tx
      .select()
      .from(labReagentLoad)
      .where(and(inArray(labReagentLoad.id, loadIds), isNull(labReagentLoad.unloadedAt), sql`${labReagentLoad.capacityTests} is not null`));
    if (loads.length === 0) return;
    const uses = await tx
      .select({ loadId: labReagentUse.reagentLoadId, kind: labReagentUse.kind, tests: sql<number>`sum(${labReagentUse.tests})::int` })
      .from(labReagentUse)
      .where(
        inArray(
          labReagentUse.reagentLoadId,
          loads.map((l) => l.id),
        ),
      )
      .groupBy(labReagentUse.reagentLoadId, labReagentUse.kind);
    for (const load of loads) {
      const use = summarizeReagentUse(
        uses.filter((u) => u.loadId === load.id),
        load.capacityTests,
        true,
      );
      if (!use.low || use.capacity === null || use.remaining === null) continue;
      const [raised] = await tx
        .insert(labReagentLowAlert)
        .values({ reagentLoadId: load.id, organizationId, facilityId: load.facilityId, capacityTests: use.capacity, remainingTests: use.remaining })
        .onConflictDoNothing()
        .returning({ loadId: labReagentLowAlert.reagentLoadId });
      if (!raised) continue;
      await this.events.record(tx, {
        type: "LaboratoryReagentLow",
        organizationId,
        aggregateType: "lab_instrument",
        aggregateId: load.instrumentId,
        facilityId: load.facilityId,
        payload: { loadId: load.id, capacity: use.capacity, remaining: use.remaining },
      });
    }
  }

  /** What a low-reagent notice names: the instrument, the reagent and its lot (no patient or run data). */
  async lowAlertSummary(organizationId: string, loadId: string) {
    const [row] = await this.db
      .select({ load: labReagentLoad, instrumentCode: labInstrument.code, alert: labReagentLowAlert })
      .from(labReagentLowAlert)
      .innerJoin(labReagentLoad, eq(labReagentLoad.id, labReagentLowAlert.reagentLoadId))
      .innerJoin(labInstrument, eq(labInstrument.id, labReagentLoad.instrumentId))
      .where(and(eq(labReagentLowAlert.organizationId, organizationId), eq(labReagentLowAlert.reagentLoadId, loadId)));
    if (!row) return undefined;
    return {
      instrumentCode: row.instrumentCode,
      itemName: row.load.itemName,
      lotNumber: row.load.lotNumber,
      capacity: row.alert.capacityTests,
      remaining: row.alert.remainingTests,
      /** Unloaded since the alert was raised (nothing to replace any more). */
      unloaded: row.load.unloadedAt !== null,
    };
  }

  private facilities(executor: DbExecutor, loadIds: string[]) {
    return executor.select({ id: labReagentLoad.id, facilityId: labReagentLoad.facilityId }).from(labReagentLoad).where(inArray(labReagentLoad.id, loadIds));
  }

  private async testNames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({ id: labTest.id, name: labTest.name })
      .from(labTest)
      .where(inArray(labTest.id, [...new Set(ids)]));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private async instrument(executor: DbExecutor, organizationId: string, instrumentId: string, lock = false) {
    const query = executor
      .select()
      .from(labInstrument)
      .where(and(eq(labInstrument.organizationId, organizationId), eq(labInstrument.id, instrumentId)));
    const [row] = lock ? await query.for("update") : await query;
    return found(row, "Instrument");
  }

  private async today(organizationId: string, facilityId: string): Promise<string> {
    const facility = await this.organizations.getFacility(organizationId, facilityId);
    return localDate(new Date(), facility.timezone);
  }
}

export function isExpired(expiryDate: string | null, today: string): boolean {
  return expiryDate !== null && expiryDate < today;
}

export function recorded(load: LabReagentLoadRecord): RecordedReagent {
  return { loadId: load.id, itemCode: load.itemCode, itemName: load.itemName, lotNumber: load.lotNumber, expiryDate: load.expiryDate };
}
