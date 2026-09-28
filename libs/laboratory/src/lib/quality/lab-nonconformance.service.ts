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
  NotFoundError,
  requireFacilityId,
} from "@healthcare/core";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import { labInstrument, labQcRun, labSpecimen } from "../laboratory.schema";
import { assertVersion, found, publicView } from "../laboratory-support";
import { LABORATORY_CONTEXT, type LaboratoryContext } from "../ports";
import type { createNonconformanceSchema, nonconformanceEntrySchema, reclassifySchema } from "./quality-management.dto";
import { missingToClose } from "./quality-management.rules";
import {
  labNonconformance,
  labNonconformanceEntry,
  labNonconformanceNumberSequence,
  type LabNonconformanceRecord,
  type NonconformanceCategory,
  type NonconformanceSeverity,
} from "./quality-management.schema";

export type NonconformanceSummary = Omit<LabNonconformanceRecord, "organizationId"> & {
  reportedByName: string | null;
  instrumentName: string | null;
  specimenAccession: string | null;
};

export type NonconformanceDetail = NonconformanceSummary & {
  entries: Array<{ id: string; kind: string; body: string; recordedAt: Date; recordedByName: string | null }>;
  /** Steps still missing before it can be closed. */
  missingToClose: string[];
};

/** What the platform opens a nonconformance about (temperature excursion, unacceptable EQA result). */
export interface PlatformNonconformance {
  facilityId: string;
  category: NonconformanceCategory;
  severity: NonconformanceSeverity;
  title: string;
  description: string;
  occurredAt: Date;
  temperatureReadingId?: string;
  eqaResultId?: string;
}

/**
 * Nonconformance (incidents) with corrective and preventive action: numbered
 * records at a facility, an append-only investigation trail (correction, root
 * cause, corrective and preventive action, effectiveness check), and closing
 * — which needs lab.qc.manage and the root cause, corrective action and
 * effectiveness check on record. A closed record never changes.
 */
@Injectable()
export class LabNonconformanceService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(LABORATORY_CONTEXT) private readonly context: LaboratoryContext,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
  ) {}

  async list(actor: Actor, status: "open" | "closed" | "all"): Promise<NonconformanceSummary[]> {
    const facilityId = requireFacilityId(actor);
    const rows = await this.db
      .select()
      .from(labNonconformance)
      .where(
        and(
          eq(labNonconformance.organizationId, actor.organizationId),
          eq(labNonconformance.facilityId, facilityId),
          status === "open" ? ne(labNonconformance.status, "closed") : status === "closed" ? eq(labNonconformance.status, "closed") : undefined,
        ),
      )
      .orderBy(desc(labNonconformance.reportedAt))
      .limit(300);
    return this.summaries(actor.organizationId, rows);
  }

  async get(actor: Actor, id: string): Promise<NonconformanceDetail> {
    const record = await this.find(this.db, actor.organizationId, id);
    return this.detail(this.db, actor.organizationId, record);
  }

  async create(actor: Actor, input: z.infer<typeof createNonconformanceSchema>): Promise<NonconformanceDetail> {
    const facilityId = requireFacilityId(actor);
    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
    if (occurredAt.getTime() > Date.now() + 60_000) throw new BusinessRuleError("It cannot have happened in the future", "occurred_in_future");
    return this.db.transaction(async (tx) => {
      const specimenId = input.specimenAccession ? await this.specimenByAccession(tx, actor.organizationId, facilityId, input.specimenAccession) : null;
      if (input.instrumentId) await this.assertOwn(tx, labInstrument, actor.organizationId, input.instrumentId, "Instrument");
      if (input.qcRunId) await this.assertOwn(tx, labQcRun, actor.organizationId, input.qcRunId, "QC run");
      const record = await this.insert(tx, actor, {
        facilityId,
        category: input.category,
        severity: input.severity,
        title: input.title,
        description: input.description,
        occurredAt,
        instrumentId: input.instrumentId ?? null,
        qcRunId: input.qcRunId ?? null,
        specimenId,
        reportedBy: actor.userId,
      });
      return this.detail(tx, actor.organizationId, record);
    });
  }

  /**
   * Opened by the platform inside the caller's transaction (a temperature excursion, an unacceptable EQA result);
   * one per source (unique index), so a retried request finds the existing record.
   */
  async openFromPlatform(tx: DbExecutor, actor: Actor, input: PlatformNonconformance): Promise<LabNonconformanceRecord> {
    return this.insert(tx, actor, {
      ...input,
      temperatureReadingId: input.temperatureReadingId ?? null,
      eqaResultId: input.eqaResultId ?? null,
      reportedBy: actor.kind === "user" ? actor.userId : null,
    });
  }

  /** Adds to the trail; the first investigation step moves an open record to "investigating". */
  async addEntry(actor: Actor, id: string, input: z.infer<typeof nonconformanceEntrySchema>): Promise<NonconformanceDetail> {
    return this.db.transaction(async (tx) => {
      const record = await this.lock(tx, actor.organizationId, id);
      if (record.status === "closed") throw new BusinessRuleError("The nonconformance is closed", "nonconformance_closed");
      await tx
        .insert(labNonconformanceEntry)
        .values({ organizationId: actor.organizationId, nonconformanceId: id, kind: input.kind, body: input.body, recordedBy: actor.userId });
      let updated = record;
      if (record.status === "open" && input.kind !== "note") {
        updated = await this.update(tx, id, { status: "investigating" });
      }
      await this.audit.record(tx, actor, {
        action: "lab.nonconformance.entry",
        resourceType: "lab_nonconformance",
        resourceId: id,
        metadata: { kind: input.kind, number: record.number },
      });
      return this.detail(tx, actor.organizationId, updated);
    });
  }

  async reclassify(actor: Actor, id: string, input: z.infer<typeof reclassifySchema>): Promise<NonconformanceDetail> {
    return this.db.transaction(async (tx) => {
      const record = await this.lock(tx, actor.organizationId, id);
      assertVersion(record.version, input.version, "Nonconformance");
      if (record.status === "closed") throw new BusinessRuleError("The nonconformance is closed", "nonconformance_closed");
      const category = input.category ?? record.category;
      const severity = input.severity ?? record.severity;
      if (category === record.category && severity === record.severity) throw new BusinessRuleError("Nothing changes", "no_change");
      const updated = await this.update(tx, id, { category, severity });
      await tx.insert(labNonconformanceEntry).values({
        organizationId: actor.organizationId,
        nonconformanceId: id,
        kind: "reclassified",
        body: `${record.category}/${record.severity} → ${category}/${severity}: ${input.reason}`,
        recordedBy: actor.userId,
      });
      await this.audit.record(tx, actor, {
        action: "lab.nonconformance.reclassify",
        resourceType: "lab_nonconformance",
        resourceId: id,
        reason: input.reason,
        changes: { category: { from: record.category, to: category }, severity: { from: record.severity, to: severity } },
      });
      return this.detail(tx, actor.organizationId, updated);
    });
  }

  async close(actor: Actor, id: string, summary: string, version: number): Promise<NonconformanceDetail> {
    if (!actor.permissions.has("lab.qc.manage")) throw new ForbiddenError("Closing a nonconformance requires lab.qc.manage");
    return this.db.transaction(async (tx) => {
      const record = await this.lock(tx, actor.organizationId, id);
      assertVersion(record.version, version, "Nonconformance");
      if (record.status === "closed") throw new ConflictError("The nonconformance is already closed", undefined, "nonconformance_closed");
      const kinds = await tx.select({ kind: labNonconformanceEntry.kind }).from(labNonconformanceEntry).where(eq(labNonconformanceEntry.nonconformanceId, id));
      const missing = missingToClose(kinds.map((k) => k.kind));
      if (missing.length) throw new BusinessRuleError(`Record the ${missing.join(", ")} before closing`, "nonconformance_incomplete", { missing });
      await tx
        .insert(labNonconformanceEntry)
        .values({ organizationId: actor.organizationId, nonconformanceId: id, kind: "closed", body: summary, recordedBy: actor.userId });
      const now = new Date();
      const updated = await this.update(tx, id, { status: "closed", closedAt: now, closedBy: actor.userId });
      await this.audit.record(tx, actor, { action: "lab.nonconformance.close", resourceType: "lab_nonconformance", resourceId: id, reason: summary });
      await this.events.record(tx, {
        type: "LaboratoryNonconformanceClosed",
        organizationId: actor.organizationId,
        aggregateType: "lab_nonconformance",
        aggregateId: id,
        facilityId: record.facilityId,
        payload: { number: record.number, category: record.category, severity: record.severity },
      });
      return this.detail(tx, actor.organizationId, updated);
    });
  }

  /** Open (not closed) records at a facility, for dashboards. */
  async openCount(executor: DbExecutor, organizationId: string, facilityId: string): Promise<number> {
    const [row] = await executor
      .select({ n: sql<number>`count(*)::int` })
      .from(labNonconformance)
      .where(and(eq(labNonconformance.organizationId, organizationId), eq(labNonconformance.facilityId, facilityId), ne(labNonconformance.status, "closed")));
    return row?.n ?? 0;
  }

  // ---- internals ------------------------------------------------------------------------

  private async insert(
    tx: DbExecutor,
    actor: Actor,
    values: Omit<typeof labNonconformance.$inferInsert, "organizationId" | "number">,
  ): Promise<LabNonconformanceRecord> {
    const [counter] = await tx
      .insert(labNonconformanceNumberSequence)
      .values({ organizationId: actor.organizationId, nextValue: 1 })
      .onConflictDoUpdate({ target: labNonconformanceNumberSequence.organizationId, set: { nextValue: sql`${labNonconformanceNumberSequence.nextValue} + 1` } })
      .returning({ value: labNonconformanceNumberSequence.nextValue });
    if (!counter) throw new Error("Could not allocate a nonconformance number");
    const [row] = await tx
      .insert(labNonconformance)
      .values({ ...values, organizationId: actor.organizationId, number: `NC${String(counter.value).padStart(8, "0")}` })
      .returning();
    const record = found(row, "Nonconformance");
    await this.audit.record(tx, actor, {
      action: "lab.nonconformance.open",
      resourceType: "lab_nonconformance",
      resourceId: record.id,
      metadata: { number: record.number, category: record.category, severity: record.severity },
    });
    await this.events.record(tx, {
      type: "LaboratoryNonconformanceOpened",
      organizationId: record.organizationId,
      aggregateType: "lab_nonconformance",
      aggregateId: record.id,
      facilityId: record.facilityId,
      payload: { number: record.number, category: record.category, severity: record.severity },
    });
    return record;
  }

  private async update(tx: DbExecutor, id: string, set: Partial<typeof labNonconformance.$inferInsert>): Promise<LabNonconformanceRecord> {
    const [row] = await tx
      .update(labNonconformance)
      .set({ ...set, updatedAt: new Date(), version: sql`${labNonconformance.version} + 1` })
      .where(eq(labNonconformance.id, id))
      .returning();
    return found(row, "Nonconformance");
  }

  private async detail(executor: DbExecutor, organizationId: string, record: LabNonconformanceRecord): Promise<NonconformanceDetail> {
    const entries = await executor
      .select()
      .from(labNonconformanceEntry)
      .where(eq(labNonconformanceEntry.nonconformanceId, record.id))
      .orderBy(asc(labNonconformanceEntry.recordedAt));
    const [[summary], names] = await Promise.all([
      this.summaries(organizationId, [record], executor),
      this.context.staffNames(organizationId, [...new Set(entries.map((e) => e.recordedBy))]),
    ]);
    return {
      ...summary!,
      entries: entries.map((e) => ({ id: e.id, kind: e.kind, body: e.body, recordedAt: e.recordedAt, recordedByName: names.get(e.recordedBy) ?? null })),
      missingToClose: record.status === "closed" ? [] : missingToClose(entries.map((e) => e.kind)),
    };
  }

  private async summaries(organizationId: string, rows: LabNonconformanceRecord[], executor: DbExecutor = this.db): Promise<NonconformanceSummary[]> {
    if (rows.length === 0) return [];
    const instrumentIds = [...new Set(rows.map((r) => r.instrumentId).filter((id): id is string => !!id))];
    const specimenIds = [...new Set(rows.map((r) => r.specimenId).filter((id): id is string => !!id))];
    const [instruments, specimens, names] = await Promise.all([
      instrumentIds.length
        ? executor.select({ id: labInstrument.id, name: labInstrument.name }).from(labInstrument).where(inArray(labInstrument.id, instrumentIds))
        : [],
      specimenIds.length
        ? executor.select({ id: labSpecimen.id, accessionNumber: labSpecimen.accessionNumber }).from(labSpecimen).where(inArray(labSpecimen.id, specimenIds))
        : [],
      this.context.staffNames(organizationId, [...new Set(rows.map((r) => r.reportedBy).filter((id): id is string => !!id))]),
    ]);
    return rows.map((r) => ({
      ...publicView(r),
      reportedByName: r.reportedBy ? (names.get(r.reportedBy) ?? null) : null,
      instrumentName: instruments.find((i) => i.id === r.instrumentId)?.name ?? null,
      specimenAccession: specimens.find((s) => s.id === r.specimenId)?.accessionNumber ?? null,
    }));
  }

  private async specimenByAccession(tx: DbExecutor, organizationId: string, facilityId: string, accession: string): Promise<string> {
    const [row] = await tx
      .select({ id: labSpecimen.id })
      .from(labSpecimen)
      .where(and(eq(labSpecimen.organizationId, organizationId), eq(labSpecimen.facilityId, facilityId), eq(labSpecimen.accessionNumber, accession)));
    if (!row) throw new NotFoundError("Specimen with this accession number at this facility");
    return row.id;
  }

  private async assertOwn(tx: DbExecutor, table: typeof labInstrument | typeof labQcRun, organizationId: string, id: string, resource: string) {
    const [row] = await tx
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.organizationId, organizationId), eq(table.id, id)));
    found(row, resource);
  }

  private async find(executor: DbExecutor, organizationId: string, id: string): Promise<LabNonconformanceRecord> {
    const [row] = await executor
      .select()
      .from(labNonconformance)
      .where(and(eq(labNonconformance.organizationId, organizationId), eq(labNonconformance.id, id)));
    return found(row, "Nonconformance");
  }

  private async lock(tx: DbExecutor, organizationId: string, id: string): Promise<LabNonconformanceRecord> {
    const [row] = await tx
      .select()
      .from(labNonconformance)
      .where(and(eq(labNonconformance.organizationId, organizationId), eq(labNonconformance.id, id)))
      .for("update");
    return found(row, "Nonconformance");
  }
}
