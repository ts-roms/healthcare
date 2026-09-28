import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  type Actor,
  BusinessRuleError,
  ConflictError,
  DATABASE,
  type Database,
  type DbExecutor,
  DomainEventPublisher,
  ForbiddenError,
  localDate,
  NotFoundError,
  requireFacilityId,
} from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { labInstrument, labQcRunReagent, labReagentLoad, type LabReagentLoadRecord, labResultReagent, labTest } from "../laboratory.schema";
import { found, publicView } from "../laboratory-support";
import { LABORATORY_CONTEXT, type LaboratoryContext } from "../ports";

/** Only inventory items of this category are loaded on instruments (and taken from stock when loading). */
export const REAGENT_CATEGORY = "reagent";

export type ReagentLoadView = Omit<LabReagentLoadRecord, "organizationId"> & {
  testName: string | null;
  instrumentName: string;
  loadedByName: string | null;
  unloadedByName: string | null;
  /** The lot's expiry date has passed (facility time zone). */
  expired: boolean;
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
    input: { inventoryLotId: string; testId?: string; takeFromStock?: { locationId: string; quantity: number } },
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

  async recordOnResult(tx: DbExecutor, organizationId: string, resultId: string, loadIds: string[]): Promise<void> {
    if (loadIds.length === 0) return;
    await tx.insert(labResultReagent).values(loadIds.map((reagentLoadId) => ({ organizationId, resultId, reagentLoadId })));
  }

  async recordOnQcRun(tx: DbExecutor, organizationId: string, qcRunId: string, loadIds: string[]): Promise<void> {
    if (loadIds.length === 0) return;
    await tx.insert(labQcRunReagent).values(loadIds.map((reagentLoadId) => ({ organizationId, qcRunId, reagentLoadId })));
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
    const [today, instruments, tests, names] = await Promise.all([
      this.today(organizationId, facilityId),
      this.db
        .select({ id: labInstrument.id, name: labInstrument.name })
        .from(labInstrument)
        .where(inArray(labInstrument.id, [...new Set(rows.map((r) => r.instrumentId))])),
      this.testNames(rows.map((r) => r.testId).filter((id): id is string => !!id)),
      this.context.staffNames(organizationId, [...new Set(rows.flatMap((r) => [r.loadedBy, r.unloadedBy]).filter((id): id is string => !!id))]),
    ]);
    return rows.map((r) => ({
      ...publicView(r),
      testName: r.testId ? (tests.get(r.testId) ?? null) : null,
      instrumentName: instruments.find((i) => i.id === r.instrumentId)?.name ?? "",
      loadedByName: names.get(r.loadedBy) ?? null,
      unloadedByName: r.unloadedBy ? (names.get(r.unloadedBy) ?? null) : null,
      expired: isExpired(r.expiryDate, today),
    }));
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
