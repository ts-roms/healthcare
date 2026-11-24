import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  type Actor,
  asPgError,
  BusinessRuleError,
  ConflictError,
  DATABASE,
  type Database,
  NotFoundError,
  PgErrorCode,
  VersionConflictError,
} from "@healthcare/core";
import { and, asc, eq } from "drizzle-orm";
import type { z } from "zod";
import { medicineWords } from "../assistant/prescribing.rules";
import type { medicineSettingSchema, updateMedicineSettingSchema } from "../prescription.dto";
import { prescribingMedicine, type PrescribingMedicineRecord } from "../prescription.schema";

export interface MedicineSettingView {
  id: string;
  name: string;
  className: string | null;
  maxDailyDose: number | null;
  doseUnit: string | null;
  checkRenal: boolean;
  checkPregnancy: boolean;
  note: string | null;
  status: "active" | "inactive";
  version: number;
  updatedAt: string;
}

type MedicineSettingInput = z.infer<typeof medicineSettingSchema>;
type MedicineSettingUpdate = z.infer<typeof updateMedicineSettingSchema>;

/**
 * The organization's own settings per medicine (docs/domains/prescription.md, "Medicine settings"; migration 0156): a
 * class of its own, a maximum daily dose in one unit, and checks to prompt before prescribing. Only the assistant's
 * prescribing rules read them, and they never block a prescription. Nothing is shipped: every value is the
 * organization's, validated by its clinicians. Changes are versioned and audited.
 */
@Injectable()
export class PrescribingMedicineService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string, includeInactive = false): Promise<MedicineSettingView[]> {
    const rows = await this.db
      .select()
      .from(prescribingMedicine)
      .where(and(eq(prescribingMedicine.organizationId, organizationId), includeInactive ? undefined : eq(prescribingMedicine.status, "active")))
      .orderBy(asc(prescribingMedicine.name));
    return rows.map(view);
  }

  async create(actor: Actor, input: MedicineSettingInput): Promise<MedicineSettingView> {
    const values = fields(input);
    try {
      return await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(prescribingMedicine)
          .values({ organizationId: actor.organizationId, ...values, createdBy: actor.userId, updatedBy: actor.userId })
          .returning();
        if (!row) throw new NotFoundError("Medicine setting");
        await this.audit.record(tx, actor, {
          action: "prescription.medicine-setting.create",
          resourceType: "prescribing_medicine",
          resourceId: row.id,
          metadata: { name: row.name, ...summary(row) },
        });
        return view(row);
      });
    } catch (error) {
      throw duplicate(error);
    }
  }

  /** Replaces the setting's values and may turn it off or on again (`version` as last read). */
  async update(actor: Actor, id: string, input: MedicineSettingUpdate): Promise<MedicineSettingView> {
    const values = fields(input);
    try {
      return await this.db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(prescribingMedicine)
          .where(and(eq(prescribingMedicine.organizationId, actor.organizationId), eq(prescribingMedicine.id, id)))
          .for("update");
        if (!current) throw new NotFoundError("Medicine setting");
        if (current.version !== input.version) throw new VersionConflictError("Medicine setting", input.version);
        const [row] = await tx
          .update(prescribingMedicine)
          .set({ ...values, status: input.status, updatedBy: actor.userId, updatedAt: new Date(), version: current.version + 1 })
          .where(eq(prescribingMedicine.id, id))
          .returning();
        if (!row) throw new NotFoundError("Medicine setting");
        await this.audit.record(tx, actor, {
          action: "prescription.medicine-setting.update",
          resourceType: "prescribing_medicine",
          resourceId: id,
          changes: changes(current, row),
          metadata: { name: row.name, status: row.status, version: row.version },
        });
        return view(row);
      });
    } catch (error) {
      throw duplicate(error);
    }
  }
}

/** The stored values: the name's words as its key, a maximum only with its unit. */
function fields(input: MedicineSettingInput) {
  const key = medicineWords(input.name).join(" ");
  if (!key) throw new BusinessRuleError("The name needs a word that is not a strength or a dosage form", "medicine_name_unreadable");
  return {
    name: input.name,
    nameKey: key,
    className: input.className ?? null,
    maxDailyDose: input.maxDailyDose ?? null,
    doseUnit: input.maxDailyDose ? (input.doseUnit ?? null) : null,
    checkRenal: input.checkRenal,
    checkPregnancy: input.checkPregnancy,
    note: input.note ?? null,
  };
}

function duplicate(error: unknown): unknown {
  return asPgError(error)?.code === PgErrorCode.uniqueViolation
    ? new ConflictError("This medicine already has a setting", undefined, "duplicate_medicine_setting")
    : error;
}

function summary(row: PrescribingMedicineRecord) {
  return {
    className: row.className,
    maxDailyDose: row.maxDailyDose === null ? null : `${row.maxDailyDose} ${row.doseUnit ?? ""}`.trim(),
    checkRenal: row.checkRenal,
    checkPregnancy: row.checkPregnancy,
  };
}

function changes(before: PrescribingMedicineRecord, after: PrescribingMedicineRecord): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  const a = { ...summary(before), name: before.name, note: before.note, status: before.status };
  const b = { ...summary(after), name: after.name, note: after.note, status: after.status };
  for (const key of Object.keys(b) as Array<keyof typeof b>) if (a[key] !== b[key]) out[key] = { from: a[key], to: b[key] };
  return out;
}

function view(row: PrescribingMedicineRecord): MedicineSettingView {
  return {
    id: row.id,
    name: row.name,
    className: row.className,
    maxDailyDose: row.maxDailyDose,
    doseUnit: row.doseUnit,
    checkRenal: row.checkRenal,
    checkPregnancy: row.checkPregnancy,
    note: row.note,
    status: row.status,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}
