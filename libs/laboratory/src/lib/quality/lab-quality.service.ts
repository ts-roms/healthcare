import { Inject, Injectable } from "@nestjs/common";
import { AuditService, diffChanges } from "@healthcare/audit";
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
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import { LabCatalogService } from "../catalog/lab-catalog.service";
import {
  type InstrumentStatus,
  labInstrument,
  labInstrumentEvent,
  type LabInstrumentEventRecord,
  type LabInstrumentRecord,
  labQcAction,
  labQcLot,
  labQcMaterial,
  labQcRun,
  type LabQcRunRecord,
  labQcTarget,
  labTest,
  type QcStatus,
} from "../laboratory.schema";
import { assertVersion, found, publicView, uniquely } from "../laboratory-support";
import { LABORATORY_CONTEXT, type LaboratoryContext } from "../ports";
import { isExpired, LabReagentService, type RecordedReagent, recorded } from "./lab-reagent.service";
import { decisiveRun, evaluateQc, qcAllowsResults, qcWindowStart, zScore } from "./qc.rules";
import type {
  addQcTargetSchema,
  createInstrumentSchema,
  createQcLotSchema,
  createQcMaterialSchema,
  instrumentEventSchema,
  recordQcRunSchema,
  updateInstrumentSchema,
} from "./quality.dto";

/** Controls read together by the multirules: the current one and up to nine before it. */
const QC_HISTORY = 9;

/** Which service status each log entry kind moves an instrument to, and from which. */
const STATUS_CHANGES: Partial<Record<LabInstrumentEventRecord["kind"], { from: InstrumentStatus[]; to: InstrumentStatus }>> = {
  out_of_service: { from: ["active"], to: "out_of_service" },
  returned_to_service: { from: ["out_of_service"], to: "active" },
  retired: { from: ["active", "out_of_service"], to: "retired" },
};

export type InstrumentView = Omit<LabInstrumentRecord, "organizationId"> & {
  lastCalibration: { performedAt: Date; outcome: "pass" | "fail" | null; nextDueOn: string | null } | null;
  lastMaintenance: { performedAt: Date; nextDueOn: string | null } | null;
  /** The next calibration date has passed (facility time zone). A reminder; it does not block use. */
  calibrationOverdue: boolean;
};

export type QcRunView = Omit<LabQcRunRecord, "organizationId"> & {
  enteredByName: string | null;
  lotNumber: string;
  materialName: string;
  level: string;
  actions: Array<{ id: string; action: string; recordedAt: Date; recordedByName: string | null }>;
  /** Reagent lots loaded on the instrument for the test when the run was recorded. */
  reagents: RecordedReagent[];
};

/**
 * Laboratory quality management (Phase 9, first part): the instrument
 * register with its maintenance and calibration log, internal QC (control
 * materials, lots, versioned targets per test and instrument, runs evaluated
 * with the facility's Westgard rules, corrective actions), and the QC check
 * that results entered on an instrument go through. Every change is audited;
 * the log, runs, targets and actions are append-only in the database.
 */
@Injectable()
export class LabQualityService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(LABORATORY_CONTEXT) private readonly context: LaboratoryContext,
    private readonly catalog: LabCatalogService,
    private readonly reagents: LabReagentService,
    private readonly organizations: OrganizationService,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
  ) {}

  // ---- Instruments ----------------------------------------------------------------------

  async listInstruments(actor: Actor, includeRetired: boolean): Promise<InstrumentView[]> {
    const facilityId = requireFacilityId(actor);
    const rows = await this.db
      .select()
      .from(labInstrument)
      .where(
        and(
          eq(labInstrument.organizationId, actor.organizationId),
          eq(labInstrument.facilityId, facilityId),
          includeRetired ? undefined : ne(labInstrument.status, "retired"),
        ),
      )
      .orderBy(asc(labInstrument.name));
    if (rows.length === 0) return [];
    const facility = await this.organizations.getFacility(actor.organizationId, facilityId);
    const today = localDate(new Date(), facility.timezone);
    // The latest calibration and maintenance entry per instrument.
    const latest = await this.db
      .selectDistinctOn([labInstrumentEvent.instrumentId, labInstrumentEvent.kind])
      .from(labInstrumentEvent)
      .where(
        and(
          inArray(
            labInstrumentEvent.instrumentId,
            rows.map((r) => r.id),
          ),
          inArray(labInstrumentEvent.kind, ["calibration", "maintenance"]),
        ),
      )
      .orderBy(labInstrumentEvent.instrumentId, labInstrumentEvent.kind, desc(labInstrumentEvent.performedAt));
    return rows.map((row) => {
      const calibration = latest.find((e) => e.instrumentId === row.id && e.kind === "calibration");
      const maintenance = latest.find((e) => e.instrumentId === row.id && e.kind === "maintenance");
      return {
        ...publicView(row),
        lastCalibration: calibration ? { performedAt: calibration.performedAt, outcome: calibration.outcome, nextDueOn: calibration.nextDueOn } : null,
        lastMaintenance: maintenance ? { performedAt: maintenance.performedAt, nextDueOn: maintenance.nextDueOn } : null,
        calibrationOverdue: !!calibration?.nextDueOn && calibration.nextDueOn < today,
      };
    });
  }

  async createInstrument(actor: Actor, input: z.infer<typeof createInstrumentSchema>) {
    const facilityId = requireFacilityId(actor);
    return this.db.transaction(async (tx) => {
      const [row] = await uniquely(
        () =>
          tx
            .insert(labInstrument)
            .values({
              organizationId: actor.organizationId,
              facilityId,
              code: input.code,
              name: input.name,
              departmentId: input.departmentId ?? null,
              manufacturer: input.manufacturer ?? null,
              model: input.model ?? null,
              serialNumber: input.serialNumber ?? null,
              createdBy: actor.userId,
            })
            .returning(),
        "An instrument with this code already exists at this facility",
        "duplicate_code",
      ).catch(rethrowForeignKey("Laboratory department"));
      const created = found(row, "Instrument");
      await this.audit.record(tx, actor, {
        action: "lab.instrument.create",
        resourceType: "lab_instrument",
        resourceId: created.id,
        metadata: { code: created.code, facilityId },
      });
      return publicView(created);
    });
  }

  async updateInstrument(actor: Actor, instrumentId: string, input: z.infer<typeof updateInstrumentSchema>) {
    const { version, ...changes } = input;
    return this.db.transaction(async (tx) => {
      const current = await this.lockInstrument(tx, actor.organizationId, instrumentId);
      assertVersion(current.version, version, "Instrument");
      if (current.status === "retired") throw new BusinessRuleError("A retired instrument is not changed", "instrument_retired");
      const [row] = await tx
        .update(labInstrument)
        .set({ ...changes, updatedAt: new Date(), version: sql`${labInstrument.version} + 1` })
        .where(eq(labInstrument.id, instrumentId))
        .returning()
        .catch(rethrowForeignKey("Laboratory department"));
      await this.audit.record(tx, actor, {
        action: "lab.instrument.update",
        resourceType: "lab_instrument",
        resourceId: instrumentId,
        changes: diffChanges(current, changes, ["name", "departmentId", "manufacturer", "model", "serialNumber"]),
      });
      return publicView(found(row, "Instrument"));
    });
  }

  /**
   * Records maintenance, calibration, repair or verification, or takes the instrument out of service, back into
   * service, or retires it (retiring needs lab.qc.manage). The log is append-only.
   */
  async recordInstrumentEvent(actor: Actor, instrumentId: string, input: z.infer<typeof instrumentEventSchema>) {
    const performedAt = input.performedAt ? new Date(input.performedAt) : new Date();
    if (performedAt.getTime() > Date.now() + 60_000) throw new BusinessRuleError("The work cannot be in the future", "performed_in_future");
    if (["calibration", "verification"].includes(input.kind) && !input.outcome) {
      throw new BusinessRuleError("Record whether the calibration or verification passed", "outcome_required");
    }
    if (["out_of_service", "retired", "repair"].includes(input.kind) && !input.notes) {
      throw new BusinessRuleError("Say why (notes are required)", "notes_required");
    }
    if (input.kind === "retired" && !actor.permissions.has("lab.qc.manage")) throw new ForbiddenError("Retiring an instrument requires lab.qc.manage");
    return this.db.transaction(async (tx) => {
      const instrument = await this.lockInstrument(tx, actor.organizationId, instrumentId);
      if (instrument.facilityId !== requireFacilityId(actor)) throw new BusinessRuleError("This instrument belongs to another facility", "wrong_facility");
      if (instrument.status === "retired") throw new BusinessRuleError("The instrument is retired", "instrument_retired");
      const change = STATUS_CHANGES[input.kind];
      if (change && !change.from.includes(instrument.status)) {
        throw new ConflictError(`The instrument is ${instrument.status.replace(/_/g, " ")}`, undefined, "invalid_instrument_status");
      }
      const [row] = await tx
        .insert(labInstrumentEvent)
        .values({
          organizationId: actor.organizationId,
          instrumentId,
          kind: input.kind,
          outcome: input.outcome ?? null,
          performedAt,
          nextDueOn: input.nextDueOn ?? null,
          notes: input.notes ?? null,
          recordedBy: actor.userId,
        })
        .returning();
      if (change) {
        await tx
          .update(labInstrument)
          .set({ status: change.to, updatedAt: new Date(), version: sql`${labInstrument.version} + 1` })
          .where(eq(labInstrument.id, instrumentId));
        await this.events.record(tx, {
          type: "LaboratoryInstrumentStatusChanged",
          organizationId: actor.organizationId,
          aggregateType: "lab_instrument",
          aggregateId: instrumentId,
          facilityId: instrument.facilityId,
          payload: { from: instrument.status, to: change.to },
        });
      }
      await this.audit.record(tx, actor, {
        action: "lab.instrument.log",
        resourceType: "lab_instrument",
        resourceId: instrumentId,
        reason: input.notes,
        metadata: { kind: input.kind, outcome: input.outcome, nextDueOn: input.nextDueOn, status: change?.to },
      });
      return publicView(found(row, "Instrument log entry"));
    });
  }

  async instrumentLog(actor: Actor, instrumentId: string) {
    await this.findInstrument(this.db, actor.organizationId, instrumentId);
    const rows = await this.db
      .select()
      .from(labInstrumentEvent)
      .where(eq(labInstrumentEvent.instrumentId, instrumentId))
      .orderBy(desc(labInstrumentEvent.performedAt), desc(labInstrumentEvent.recordedAt))
      .limit(500);
    const names = await this.context.staffNames(actor.organizationId, [...new Set(rows.map((r) => r.recordedBy))]);
    return rows.map((r) => ({ ...publicView(r), recordedByName: names.get(r.recordedBy) ?? null }));
  }

  // ---- QC materials, lots and targets ----------------------------------------------------

  /** Materials with their lots and each lot's current targets. */
  async listMaterials(actor: Actor) {
    const materials = await this.db
      .select()
      .from(labQcMaterial)
      .where(eq(labQcMaterial.organizationId, actor.organizationId))
      .orderBy(asc(labQcMaterial.name), asc(labQcMaterial.level));
    if (materials.length === 0) return [];
    const lots = await this.db
      .select()
      .from(labQcLot)
      .where(
        inArray(
          labQcLot.materialId,
          materials.map((m) => m.id),
        ),
      )
      .orderBy(desc(labQcLot.expiresOn));
    const targets = lots.length
      ? await this.db
          .select({ target: labQcTarget, testCode: labTest.code, testName: labTest.name, unit: labTest.unit, instrumentName: labInstrument.name })
          .from(labQcTarget)
          .innerJoin(labTest, eq(labTest.id, labQcTarget.testId))
          .innerJoin(labInstrument, eq(labInstrument.id, labQcTarget.instrumentId))
          .where(
            and(
              inArray(
                labQcTarget.qcLotId,
                lots.map((l) => l.id),
              ),
              isNull(labQcTarget.effectiveTo),
            ),
          )
          .orderBy(asc(labTest.name))
      : [];
    return materials.map((m) => ({
      ...publicView(m),
      lots: lots
        .filter((l) => l.materialId === m.id)
        .map((l) => ({
          ...publicView(l),
          targets: targets.filter((t) => t.target.qcLotId === l.id).map(({ target, ...test }) => ({ ...publicView(target), ...test })),
        })),
    }));
  }

  async createMaterial(actor: Actor, input: z.infer<typeof createQcMaterialSchema>) {
    return this.db.transaction(async (tx) => {
      const [row] = await uniquely(
        () =>
          tx
            .insert(labQcMaterial)
            .values({ organizationId: actor.organizationId, ...input, manufacturer: input.manufacturer ?? null })
            .returning(),
        "A QC material with this code already exists",
        "duplicate_code",
      );
      const created = found(row, "QC material");
      await this.audit.record(tx, actor, { action: "lab.qc.material.create", resourceType: "lab_qc_material", resourceId: created.id, metadata: input });
      return publicView(created);
    });
  }

  async createLot(actor: Actor, materialId: string, input: z.infer<typeof createQcLotSchema>) {
    return this.db.transaction(async (tx) => {
      const [material] = await tx
        .select()
        .from(labQcMaterial)
        .where(and(eq(labQcMaterial.organizationId, actor.organizationId), eq(labQcMaterial.id, materialId)));
      found(material, "QC material");
      const [row] = await uniquely(
        () =>
          tx
            .insert(labQcLot)
            .values({ organizationId: actor.organizationId, materialId, ...input })
            .returning(),
        "This lot is already registered for the material",
        "duplicate_lot",
      );
      const created = found(row, "QC lot");
      await this.audit.record(tx, actor, {
        action: "lab.qc.lot.create",
        resourceType: "lab_qc_lot",
        resourceId: created.id,
        metadata: { materialId, ...input },
      });
      return publicView(created);
    });
  }

  async retireLot(actor: Actor, lotId: string) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(labQcLot)
        .set({ status: "retired" })
        .where(and(eq(labQcLot.organizationId, actor.organizationId), eq(labQcLot.id, lotId), eq(labQcLot.status, "active")))
        .returning();
      const retired = found(row, "Active QC lot");
      await this.audit.record(tx, actor, { action: "lab.qc.lot.retire", resourceType: "lab_qc_lot", resourceId: lotId });
      return publicView(retired);
    });
  }

  /** Sets the target for a lot, test and instrument; the current target (if any) is closed, never rewritten. */
  async addTarget(actor: Actor, lotId: string, input: z.infer<typeof addQcTargetSchema>) {
    return this.db.transaction(async (tx) => {
      const [lot] = await tx
        .select()
        .from(labQcLot)
        .where(and(eq(labQcLot.organizationId, actor.organizationId), eq(labQcLot.id, lotId)));
      if (found(lot, "QC lot").status !== "active") throw new BusinessRuleError("The lot is retired", "qc_lot_retired");
      const [test] = await tx
        .select()
        .from(labTest)
        .where(and(eq(labTest.organizationId, actor.organizationId), eq(labTest.id, input.testId)));
      if (found(test, "Laboratory test").resultType !== "numeric") throw new BusinessRuleError("QC targets are for numeric tests", "test_not_numeric");
      await this.findInstrument(tx, actor.organizationId, input.instrumentId);
      const now = new Date();
      const [previous] = await tx
        .update(labQcTarget)
        .set({ effectiveTo: now })
        .where(
          and(
            eq(labQcTarget.qcLotId, lotId),
            eq(labQcTarget.testId, input.testId),
            eq(labQcTarget.instrumentId, input.instrumentId),
            isNull(labQcTarget.effectiveTo),
          ),
        )
        .returning();
      const [row] = await tx
        .insert(labQcTarget)
        .values({ organizationId: actor.organizationId, qcLotId: lotId, ...input, source: input.source ?? null, effectiveFrom: now, createdBy: actor.userId })
        .returning();
      const created = found(row, "QC target");
      await this.audit.record(tx, actor, {
        action: "lab.qc.target.set",
        resourceType: "lab_qc_lot",
        resourceId: lotId,
        metadata: { targetId: created.id, testId: input.testId, instrumentId: input.instrumentId, mean: input.mean, sd: input.sd, replaces: previous?.id },
      });
      return publicView(created);
    });
  }

  // ---- QC runs ---------------------------------------------------------------------------

  /** Records a control measurement and evaluates it against the lot's target and the series before it. */
  async recordRun(actor: Actor, input: z.infer<typeof recordQcRunSchema>): Promise<QcRunView> {
    const facilityId = requireFacilityId(actor);
    const runAt = input.runAt ? new Date(input.runAt) : new Date();
    if (runAt.getTime() > Date.now() + 60_000) throw new BusinessRuleError("The run cannot be in the future", "run_in_future");
    const facility = await this.organizations.getFacility(actor.organizationId, facilityId);
    return this.db.transaction(async (tx) => {
      // One run at a time per instrument, so each is evaluated against the series that includes the one before it.
      const instrument = await this.lockInstrument(tx, actor.organizationId, input.instrumentId);
      if (instrument.facilityId !== facilityId) throw new BusinessRuleError("This instrument belongs to another facility", "wrong_facility");
      if (instrument.status !== "active") throw new BusinessRuleError(`The instrument is ${instrument.status.replace(/_/g, " ")}`, "instrument_unavailable");
      const [lot] = await tx
        .select()
        .from(labQcLot)
        .where(and(eq(labQcLot.organizationId, actor.organizationId), eq(labQcLot.id, input.qcLotId)));
      const qcLot = found(lot, "QC lot");
      if (qcLot.status !== "active") throw new BusinessRuleError("The QC lot is retired", "qc_lot_retired");
      if (qcLot.expiresOn < localDate(runAt, facility.timezone)) throw new BusinessRuleError("The QC lot has expired", "qc_lot_expired");
      const [target] = await tx
        .select()
        .from(labQcTarget)
        .where(
          and(
            eq(labQcTarget.qcLotId, input.qcLotId),
            eq(labQcTarget.testId, input.testId),
            eq(labQcTarget.instrumentId, input.instrumentId),
            isNull(labQcTarget.effectiveTo),
          ),
        );
      if (!target) throw new BusinessRuleError("Set a target mean and SD for this lot, test and instrument first", "qc_target_missing");
      const reagents = await this.reagents.forUse(tx, actor.organizationId, facilityId, input.instrumentId, input.testId);
      const previous = await tx
        .select({ z: labQcRun.zScore, qcLotId: labQcRun.qcLotId })
        .from(labQcRun)
        .where(and(eq(labQcRun.instrumentId, input.instrumentId), eq(labQcRun.testId, input.testId), lte(labQcRun.runAt, runAt)))
        .orderBy(desc(labQcRun.runAt), desc(labQcRun.enteredAt))
        .limit(QC_HISTORY);
      const policy = await this.catalog.policy(tx, facilityId);
      const evaluation = evaluateQc({ z: zScore(input.value, target.mean, target.sd), qcLotId: input.qcLotId }, previous, policy.qcRejectRules);
      const [row] = await tx
        .insert(labQcRun)
        .values({
          organizationId: actor.organizationId,
          facilityId,
          instrumentId: input.instrumentId,
          testId: input.testId,
          qcLotId: input.qcLotId,
          targetId: target.id,
          value: input.value,
          targetMean: target.mean,
          targetSd: target.sd,
          zScore: evaluation.zScore,
          status: evaluation.status,
          violations: evaluation.violations,
          comment: input.comment ?? null,
          runAt,
          enteredBy: actor.userId,
        })
        .returning();
      const run = found(row, "QC run");
      await this.reagents.recordOnQcRun(tx, actor.organizationId, run, reagents.loadIds);
      await this.audit.record(tx, actor, {
        action: "lab.qc.run.record",
        resourceType: "lab_qc_run",
        resourceId: run.id,
        metadata: {
          instrumentId: run.instrumentId,
          testId: run.testId,
          qcLotId: run.qcLotId,
          status: run.status,
          violations: run.violations,
          reagentLoadIds: reagents.loadIds,
        },
      });
      if (run.status === "rejected") {
        await this.events.record(tx, {
          type: "LaboratoryQcRunRejected",
          organizationId: run.organizationId,
          aggregateType: "lab_qc_run",
          aggregateId: run.id,
          facilityId,
          payload: { instrumentId: run.instrumentId, testId: run.testId, qcLotId: run.qcLotId, violations: run.violations, enteredBy: run.enteredBy },
        });
      }
      const [view] = await this.runViews(tx, actor.organizationId, [run]);
      return view!;
    });
  }

  /** What a notice about a QC run names: the instrument and the test (no control values). */
  async runSummary(organizationId: string, runId: string): Promise<{ instrumentCode: string; testName: string } | null> {
    const [row] = await this.db
      .select({ instrumentCode: labInstrument.code, testName: labTest.name })
      .from(labQcRun)
      .innerJoin(labInstrument, and(eq(labInstrument.organizationId, labQcRun.organizationId), eq(labInstrument.id, labQcRun.instrumentId)))
      .innerJoin(labTest, and(eq(labTest.organizationId, labQcRun.organizationId), eq(labTest.id, labQcRun.testId)))
      .where(and(eq(labQcRun.organizationId, organizationId), eq(labQcRun.id, runId)));
    return row ?? null;
  }

  /** A series for the Levey-Jennings chart: runs of a test on an instrument (optionally one lot), oldest first. */
  async listRuns(actor: Actor, query: { instrumentId: string; testId: string; qcLotId?: string; days: number }): Promise<QcRunView[]> {
    await this.findInstrument(this.db, actor.organizationId, query.instrumentId);
    const rows = await this.db
      .select()
      .from(labQcRun)
      .where(
        and(
          eq(labQcRun.organizationId, actor.organizationId),
          eq(labQcRun.instrumentId, query.instrumentId),
          eq(labQcRun.testId, query.testId),
          query.qcLotId ? eq(labQcRun.qcLotId, query.qcLotId) : undefined,
          gte(labQcRun.runAt, new Date(Date.now() - query.days * 86_400_000)),
        ),
      )
      .orderBy(asc(labQcRun.runAt))
      .limit(500);
    return this.runViews(this.db, actor.organizationId, rows);
  }

  async addAction(actor: Actor, runId: string, action: string) {
    return this.db.transaction(async (tx) => {
      const [run] = await tx
        .select()
        .from(labQcRun)
        .where(and(eq(labQcRun.organizationId, actor.organizationId), eq(labQcRun.id, runId)));
      const current = found(run, "QC run");
      if (current.status === "accepted") throw new BusinessRuleError("Corrective actions are recorded for warning or rejected runs", "qc_run_accepted");
      const [row] = await tx.insert(labQcAction).values({ organizationId: actor.organizationId, qcRunId: runId, action, recordedBy: actor.userId }).returning();
      await this.audit.record(tx, actor, { action: "lab.qc.action.record", resourceType: "lab_qc_run", resourceId: runId });
      return publicView(found(row, "QC corrective action"));
    });
  }

  /**
   * The QC board at the selected facility: every test with a current target on each of its instruments, with the
   * latest run inside the facility's QC window (all control lots) and whether patient results may be entered.
   */
  async status(actor: Actor) {
    const facilityId = requireFacilityId(actor);
    const [policy, facility] = await Promise.all([this.catalog.policy(this.db, facilityId), this.organizations.getFacility(actor.organizationId, facilityId)]);
    const today = localDate(new Date(), facility.timezone);
    const since = new Date(Date.now() - policy.qcValidHours * 3_600_000);
    const pairs = await this.db
      .selectDistinct({
        instrumentId: labInstrument.id,
        instrumentName: labInstrument.name,
        instrumentStatus: labInstrument.status,
        testId: labTest.id,
        testCode: labTest.code,
        testName: labTest.name,
        unit: labTest.unit,
      })
      .from(labQcTarget)
      .innerJoin(labInstrument, eq(labInstrument.id, labQcTarget.instrumentId))
      .innerJoin(labTest, eq(labTest.id, labQcTarget.testId))
      .innerJoin(labQcLot, eq(labQcLot.id, labQcTarget.qcLotId))
      .where(
        and(
          eq(labQcTarget.organizationId, actor.organizationId),
          eq(labInstrument.facilityId, facilityId),
          ne(labInstrument.status, "retired"),
          isNull(labQcTarget.effectiveTo),
          eq(labQcLot.status, "active"),
        ),
      )
      .orderBy(asc(labInstrument.name), asc(labTest.name));
    const latest = pairs.length
      ? await this.db
          .selectDistinctOn([labQcRun.instrumentId, labQcRun.testId, labQcRun.qcLotId])
          .from(labQcRun)
          .where(
            and(
              inArray(labQcRun.instrumentId, [...new Set(pairs.map((p) => p.instrumentId))]),
              gte(labQcRun.runAt, since),
              lt(labQcRun.runAt, new Date(Date.now() + 60_000)),
            ),
          )
          .orderBy(labQcRun.instrumentId, labQcRun.testId, labQcRun.qcLotId, desc(labQcRun.runAt), desc(labQcRun.enteredAt))
      : [];
    const loads = await this.reagents.current(this.db, [...new Set(pairs.map((p) => p.instrumentId))]);
    return {
      policy: {
        qcRequired: policy.qcRequired,
        qcValidHours: policy.qcValidHours,
        qcRejectRules: policy.qcRejectRules,
        qcAfterReagentChange: policy.qcAfterReagentChange,
      },
      rows: pairs.map((pair) => {
        const applying = loads.filter((l) => l.instrumentId === pair.instrumentId && (l.testId === null || l.testId === pair.testId));
        const start = qcWindowStart(since, applying, policy.qcAfterReagentChange);
        const runs = latest
          .filter((r) => r.instrumentId === pair.instrumentId && r.testId === pair.testId && r.runAt >= start)
          .sort((a, b) => +b.runAt - +a.runAt);
        const decisive = decisiveRun(runs);
        const reagents = applying.map((l) => ({ ...recorded(l), loadedAt: l.loadedAt, expired: isExpired(l.expiryDate, today) }));
        return {
          ...pair,
          /** Runs from here on count: the QC window, or the newest reagent lot change if the policy says so. */
          qcSince: start,
          reagents,
          /** The run that decides the state: the worst latest control level within the window. */
          decisiveRun: decisive
            ? { id: decisive.id, status: decisive.status, runAt: decisive.runAt, qcLotId: decisive.qcLotId, violations: decisive.violations }
            : null,
          /** Latest run per control lot within the window, newest first. */
          lots: runs.map((r) => ({ runId: r.id, qcLotId: r.qcLotId, status: r.status, runAt: r.runAt, violations: r.violations })),
          resultsAllowed: pair.instrumentStatus === "active" && !reagents.some((r) => r.expired) && qcAllowsResults(decisive, policy.qcRequired).allowed,
        };
      }),
    };
  }

  // ---- Results ---------------------------------------------------------------------------

  /**
   * The instrument and QC in force for a result entered now: the instrument must be active at the order's facility;
   * the decisive QC run of the test on it within the facility's QC window (the worst latest control level) is linked,
   * its status snapshotted; when the facility requires QC, no run or a rejected level refuses the result.
   */
  async qcForResult(
    tx: DbExecutor,
    organizationId: string,
    facilityId: string,
    instrumentId: string,
    testId: string,
  ): Promise<{ instrument: LabInstrumentRecord; qcRunId: string | null; qcStatus: QcStatus | "none"; reagentLoadIds: string[] }> {
    const instrument = await this.findInstrument(tx, organizationId, instrumentId);
    if (instrument.facilityId !== facilityId) throw new BusinessRuleError("This instrument belongs to another facility", "wrong_facility");
    if (instrument.status !== "active") throw new BusinessRuleError(`The instrument is ${instrument.status.replace(/_/g, " ")}`, "instrument_unavailable");
    const policy = await this.catalog.policy(tx, facilityId);
    const reagents = await this.reagents.forUse(tx, organizationId, facilityId, instrumentId, testId);
    const start = qcWindowStart(new Date(Date.now() - policy.qcValidHours * 3_600_000), reagents.latestChange, policy.qcAfterReagentChange);
    const latestPerLot = await tx
      .selectDistinctOn([labQcRun.qcLotId], { id: labQcRun.id, status: labQcRun.status, runAt: labQcRun.runAt })
      .from(labQcRun)
      .where(
        and(
          eq(labQcRun.instrumentId, instrumentId),
          eq(labQcRun.testId, testId),
          gte(labQcRun.runAt, start),
          lte(labQcRun.runAt, new Date(Date.now() + 60_000)),
        ),
      )
      .orderBy(labQcRun.qcLotId, desc(labQcRun.runAt), desc(labQcRun.enteredAt));
    const decisive = decisiveRun(latestPerLot);
    const gate = qcAllowsResults(decisive, policy.qcRequired);
    if (!gate.allowed) throw new BusinessRuleError(`${gate.reason}. Run QC before entering patient results.`, "qc_not_accepted");
    return { instrument, qcRunId: decisive?.id ?? null, qcStatus: decisive?.status ?? "none", reagentLoadIds: reagents.loadIds };
  }

  /** Records the reagent lots in use on a result entered on an instrument (with qcForResult, in the same transaction). */
  recordResultReagents(
    tx: DbExecutor,
    organizationId: string,
    result: { id: string; orderId: string; testId: string; versionNumber: number; enteredBy: string },
    loadIds: string[],
  ): Promise<void> {
    return this.reagents.recordOnResult(tx, organizationId, result, loadIds);
  }

  // ---- internals ------------------------------------------------------------------------

  private async runViews(executor: DbExecutor, organizationId: string, runs: LabQcRunRecord[]): Promise<QcRunView[]> {
    if (runs.length === 0) return [];
    // One after the other: `executor` may be the caller's transaction, a single connection.
    const lots = await executor
      .select({ id: labQcLot.id, lotNumber: labQcLot.lotNumber, materialName: labQcMaterial.name, level: labQcMaterial.level })
      .from(labQcLot)
      .innerJoin(labQcMaterial, eq(labQcMaterial.id, labQcLot.materialId))
      .where(inArray(labQcLot.id, [...new Set(runs.map((r) => r.qcLotId))]));
    const actions = await executor
      .select()
      .from(labQcAction)
      .where(
        inArray(
          labQcAction.qcRunId,
          runs.map((r) => r.id),
        ),
      )
      .orderBy(asc(labQcAction.recordedAt));
    const [names, reagents] = await Promise.all([
      this.context.staffNames(organizationId, [...new Set([...runs.map((r) => r.enteredBy), ...actions.map((a) => a.recordedBy)])]),
      this.reagents.onQcRuns(
        executor,
        runs.map((r) => r.id),
      ),
    ]);
    return runs.map((run) => {
      const lot = lots.find((l) => l.id === run.qcLotId);
      return {
        ...publicView(run),
        enteredByName: names.get(run.enteredBy) ?? null,
        lotNumber: lot?.lotNumber ?? "",
        materialName: lot?.materialName ?? "",
        level: lot?.level ?? "",
        actions: actions
          .filter((a) => a.qcRunId === run.id)
          .map((a) => ({ id: a.id, action: a.action, recordedAt: a.recordedAt, recordedByName: names.get(a.recordedBy) ?? null })),
        reagents: reagents.get(run.id) ?? [],
      };
    });
  }

  private async findInstrument(executor: DbExecutor, organizationId: string, instrumentId: string): Promise<LabInstrumentRecord> {
    const [row] = await executor
      .select()
      .from(labInstrument)
      .where(and(eq(labInstrument.organizationId, organizationId), eq(labInstrument.id, instrumentId)));
    return found(row, "Instrument");
  }

  private async lockInstrument(tx: DbExecutor, organizationId: string, instrumentId: string): Promise<LabInstrumentRecord> {
    const [row] = await tx
      .select()
      .from(labInstrument)
      .where(and(eq(labInstrument.organizationId, organizationId), eq(labInstrument.id, instrumentId)))
      .for("update");
    return found(row, "Instrument");
  }
}

/** A composite foreign key failure (e.g. a department of another organization) reads as not found. */
function rethrowForeignKey(resource: string) {
  return (error: unknown): never => {
    if ((error as { code?: string }).code === "23503") throw new NotFoundError(resource);
    throw error;
  };
}
