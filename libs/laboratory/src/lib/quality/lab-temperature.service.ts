import { Inject, Injectable } from "@nestjs/common";
import { AuditService, diffChanges } from "@healthcare/audit";
import { type Actor, BusinessRuleError, DATABASE, type Database, DomainEventPublisher, requireFacilityId } from "@healthcare/core";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import { assertVersion, found, publicView, uniquely } from "../laboratory-support";
import { LABORATORY_CONTEXT, type LaboratoryContext } from "../ports";
import { LabNonconformanceService } from "./lab-nonconformance.service";
import type { createStorageUnitSchema, recordReadingSchema, updateStorageUnitSchema } from "./quality-management.dto";
import { isExcursion, readingOverdue } from "./quality-management.rules";
import { labStorageUnit, labTemperatureReading, type LabStorageUnitRecord, type LabTemperatureReadingRecord } from "./quality-management.schema";

const EXCURSION_WINDOW_DAYS = 7;

export type ReadingView = Omit<LabTemperatureReadingRecord, "organizationId"> & { recordedByName: string | null; nonconformanceId: string | null };

/**
 * Temperature monitoring of refrigerators, freezers, incubators and rooms: each
 * unit has the acceptable range and reading interval the laboratory set; each
 * reading keeps the range it was read against. A reading outside the range is
 * an excursion — it must be explained when recorded and opens a nonconformance
 * (category temperature_excursion) in the same transaction.
 */
@Injectable()
export class LabTemperatureService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(LABORATORY_CONTEXT) private readonly context: LaboratoryContext,
    private readonly nonconformances: LabNonconformanceService,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
  ) {}

  /** Units at the selected facility with their last reading, whether a reading is due, and recent excursions. */
  async units(actor: Actor, includeRetired: boolean) {
    const facilityId = requireFacilityId(actor);
    const units = await this.db
      .select()
      .from(labStorageUnit)
      .where(
        and(
          eq(labStorageUnit.organizationId, actor.organizationId),
          eq(labStorageUnit.facilityId, facilityId),
          includeRetired ? undefined : eq(labStorageUnit.status, "active"),
        ),
      )
      .orderBy(asc(labStorageUnit.name));
    if (units.length === 0) return [];
    const ids = units.map((u) => u.id);
    const [latest, excursions] = await Promise.all([
      this.db
        .selectDistinctOn([labTemperatureReading.storageUnitId])
        .from(labTemperatureReading)
        .where(inArray(labTemperatureReading.storageUnitId, ids))
        .orderBy(labTemperatureReading.storageUnitId, desc(labTemperatureReading.readAt)),
      this.db
        .select({ unitId: labTemperatureReading.storageUnitId, n: sql<number>`count(*)::int` })
        .from(labTemperatureReading)
        .where(
          and(
            inArray(labTemperatureReading.storageUnitId, ids),
            eq(labTemperatureReading.outOfRange, true),
            gte(labTemperatureReading.readAt, new Date(Date.now() - EXCURSION_WINDOW_DAYS * 86_400_000)),
          ),
        )
        .groupBy(labTemperatureReading.storageUnitId),
    ]);
    const now = new Date();
    return units.map((u) => {
      const last = latest.find((r) => r.storageUnitId === u.id) ?? null;
      return {
        ...publicView(u),
        lastReading: last ? { celsius: last.celsius, readAt: last.readAt, outOfRange: last.outOfRange } : null,
        readingDue: u.status === "active" && readingOverdue(last?.readAt ?? null, u.readingIntervalHours, now),
        excursionsLast7Days: excursions.find((e) => e.unitId === u.id)?.n ?? 0,
      };
    });
  }

  async createUnit(actor: Actor, input: z.infer<typeof createStorageUnitSchema>) {
    const facilityId = requireFacilityId(actor);
    return this.db.transaction(async (tx) => {
      const [row] = await uniquely(
        () =>
          tx
            .insert(labStorageUnit)
            .values({
              organizationId: actor.organizationId,
              facilityId,
              ...input,
              departmentId: input.departmentId ?? null,
              readingIntervalHours: input.readingIntervalHours ?? null,
              createdBy: actor.userId,
            })
            .returning(),
        "A storage unit with this code already exists at this facility",
        "duplicate_code",
      );
      const unit = found(row, "Storage unit");
      await this.audit.record(tx, actor, {
        action: "lab.storage-unit.create",
        resourceType: "lab_storage_unit",
        resourceId: unit.id,
        metadata: { code: unit.code, minCelsius: unit.minCelsius, maxCelsius: unit.maxCelsius },
      });
      return publicView(unit);
    });
  }

  /** Changing the range affects later readings only (each reading keeps its own). */
  async updateUnit(actor: Actor, id: string, input: z.infer<typeof updateStorageUnitSchema>) {
    const { version, reason, ...changes } = input;
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(labStorageUnit)
        .where(and(eq(labStorageUnit.organizationId, actor.organizationId), eq(labStorageUnit.id, id)))
        .for("update");
      const unit = found(current, "Storage unit");
      assertVersion(unit.version, version, "Storage unit");
      const min = changes.minCelsius ?? unit.minCelsius;
      const max = changes.maxCelsius ?? unit.maxCelsius;
      if (max <= min) throw new BusinessRuleError("The upper limit must be above the lower limit", "invalid_range");
      const [row] = await tx
        .update(labStorageUnit)
        .set({ ...changes, updatedAt: new Date(), version: sql`${labStorageUnit.version} + 1` })
        .where(eq(labStorageUnit.id, id))
        .returning();
      await this.audit.record(tx, actor, {
        action: "lab.storage-unit.update",
        resourceType: "lab_storage_unit",
        resourceId: id,
        reason,
        changes: diffChanges(unit, changes, ["name", "minCelsius", "maxCelsius", "readingIntervalHours", "status"]),
      });
      return publicView(found(row, "Storage unit"));
    });
  }

  async readings(actor: Actor, unitId: string, days: number): Promise<ReadingView[]> {
    await this.unit(actor.organizationId, unitId);
    const rows = await this.db
      .select()
      .from(labTemperatureReading)
      .where(and(eq(labTemperatureReading.storageUnitId, unitId), gte(labTemperatureReading.readAt, new Date(Date.now() - days * 86_400_000))))
      .orderBy(asc(labTemperatureReading.readAt))
      .limit(2000);
    return this.views(actor.organizationId, rows);
  }

  async record(actor: Actor, unitId: string, input: z.infer<typeof recordReadingSchema>): Promise<ReadingView> {
    const facilityId = requireFacilityId(actor);
    const readAt = input.readAt ? new Date(input.readAt) : new Date();
    if (readAt.getTime() > Date.now() + 60_000) throw new BusinessRuleError("The reading cannot be in the future", "read_in_future");
    const unit = await this.unit(actor.organizationId, unitId);
    if (unit.facilityId !== facilityId) throw new BusinessRuleError("This unit belongs to another facility", "wrong_facility");
    if (unit.status !== "active") throw new BusinessRuleError("The unit is retired", "storage_unit_retired");
    const outOfRange = isExcursion(input.celsius, unit.minCelsius, unit.maxCelsius);
    if (outOfRange && !input.note) {
      throw new BusinessRuleError(
        `${input.celsius} °C is outside ${unit.minCelsius} to ${unit.maxCelsius} °C. Say what was seen and done (note).`,
        "excursion_note_required",
      );
    }
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(labTemperatureReading)
        .values({
          organizationId: actor.organizationId,
          storageUnitId: unitId,
          celsius: input.celsius,
          minCelsius: unit.minCelsius,
          maxCelsius: unit.maxCelsius,
          outOfRange,
          readAt,
          note: input.note ?? null,
          recordedBy: actor.userId,
        })
        .returning();
      const reading = found(row, "Temperature reading");
      let nonconformanceId: string | null = null;
      if (outOfRange) {
        const opened = await this.nonconformances.openFromPlatform(tx, actor, {
          facilityId,
          category: "temperature_excursion",
          severity: "major",
          title: `Temperature excursion: ${unit.name}`,
          description: `${input.celsius} °C read on ${unit.name} (${unit.code}); acceptable ${unit.minCelsius} to ${unit.maxCelsius} °C. ${input.note}`,
          occurredAt: readAt,
          temperatureReadingId: reading.id,
        });
        nonconformanceId = opened.id;
        await this.events.record(tx, {
          type: "LaboratoryTemperatureExcursion",
          organizationId: actor.organizationId,
          aggregateType: "lab_storage_unit",
          aggregateId: unitId,
          facilityId,
          payload: { readingId: reading.id, nonconformanceId },
        });
      }
      await this.audit.record(tx, actor, {
        action: "lab.temperature.record",
        resourceType: "lab_storage_unit",
        resourceId: unitId,
        metadata: { readingId: reading.id, celsius: reading.celsius, outOfRange, nonconformanceId },
      });
      const [view] = await this.views(actor.organizationId, [reading], new Map(nonconformanceId ? [[reading.id, nonconformanceId]] : []));
      return view!;
    });
  }

  private async views(organizationId: string, rows: LabTemperatureReadingRecord[], opened = new Map<string, string>()): Promise<ReadingView[]> {
    if (rows.length === 0) return [];
    const names = await this.context.staffNames(organizationId, [...new Set(rows.map((r) => r.recordedBy))]);
    return rows.map((r) => ({ ...publicView(r), recordedByName: names.get(r.recordedBy) ?? null, nonconformanceId: opened.get(r.id) ?? null }));
  }

  private async unit(organizationId: string, id: string): Promise<LabStorageUnitRecord> {
    const [row] = await this.db
      .select()
      .from(labStorageUnit)
      .where(and(eq(labStorageUnit.organizationId, organizationId), eq(labStorageUnit.id, id)));
    return found(row, "Storage unit");
  }
}
