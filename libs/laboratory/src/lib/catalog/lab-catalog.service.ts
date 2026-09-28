import { Inject, Injectable } from "@nestjs/common";
import { AuditService, diffChanges } from "@healthcare/audit";
import {
  type Actor,
  asPgError,
  BusinessRuleError,
  ConflictError,
  DATABASE,
  type Database,
  type DbExecutor,
  NotFoundError,
  PgErrorCode,
} from "@healthcare/core";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { z } from "zod";
import type {
  addReferenceRangeSchema,
  createDepartmentSchema,
  createPanelSchema,
  createSpecimenTypeSchema,
  createTestSchema,
  facilityPolicySchema,
  updateCatalogEntrySchema,
  updateTestSchema,
} from "../laboratory.dto";
import {
  labDepartment,
  labFacilityPolicy,
  type LabFacilityPolicyRecord,
  labPanel,
  labPanelTest,
  labReferenceRange,
  type LabReferenceRangeRecord,
  labSpecimenType,
  labTest,
  type LabTestRecord,
  type QcRejectRule,
} from "../laboratory.schema";
import { assertVersion, found, publicView, uniquely } from "../laboratory-support";

const TEST_FIELDS = ["name", "loincCode", "unit", "turnaroundMinutes", "requiresFasting", "patientReleasable", "collectionInstructions", "status"] as const;

/** The safe default when a facility has no policy row: separation of duties, manual release. */
export const DEFAULT_LAB_POLICY = {
  allowSelfVerification: false,
  allowSelfApproval: false,
  releaseOnApproval: false,
  // Quality control (0050): the common 1_3s / 2_2s / R_4s rejection set, a 24-hour window, not required.
  qcRejectRules: ["1_3s", "2_2s", "R_4s"] as QcRejectRule[],
  qcValidHours: 24,
  qcRequired: false,
};

type PolicyFields = "allowSelfVerification" | "allowSelfApproval" | "releaseOnApproval" | "qcRejectRules" | "qcValidHours" | "qcRequired";

export type TestView = Omit<LabTestRecord, "organizationId"> & { referenceRanges: Array<Omit<LabReferenceRangeRecord, "organizationId">> };

/**
 * Laboratory master data (organization configuration): departments, specimen
 * types, tests with versioned reference ranges, panels, and per-facility
 * laboratory policy. Every change is audited.
 */
@Injectable()
export class LabCatalogService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  // ---- Departments and specimen types ----------------------------------------------------

  async listDepartments(organizationId: string, includeInactive: boolean) {
    const rows = await this.db
      .select()
      .from(labDepartment)
      .where(and(eq(labDepartment.organizationId, organizationId), includeInactive ? undefined : eq(labDepartment.status, "active")))
      .orderBy(asc(labDepartment.name));
    return rows.map(publicView);
  }

  createDepartment(actor: Actor, input: z.infer<typeof createDepartmentSchema>) {
    return uniquely(
      () =>
        this.db.transaction(async (tx) => {
          const [row] = await tx
            .insert(labDepartment)
            .values({ ...input, organizationId: actor.organizationId })
            .returning();
          const created = found(row, "Laboratory department");
          await this.audit.record(tx, actor, {
            action: "lab.department.create",
            resourceType: "lab_department",
            resourceId: created.id,
            metadata: { code: created.code },
          });
          return publicView(created);
        }),
      "A laboratory department with that code exists",
      "duplicate_code",
    );
  }

  updateDepartment(actor: Actor, id: string, input: z.infer<typeof updateCatalogEntrySchema>) {
    return this.updateSimple(actor, labDepartment, "lab_department", "lab.department.update", "Laboratory department", id, input);
  }

  async listSpecimenTypes(organizationId: string, includeInactive: boolean) {
    const rows = await this.db
      .select()
      .from(labSpecimenType)
      .where(and(eq(labSpecimenType.organizationId, organizationId), includeInactive ? undefined : eq(labSpecimenType.status, "active")))
      .orderBy(asc(labSpecimenType.name));
    return rows.map(publicView);
  }

  createSpecimenType(actor: Actor, input: z.infer<typeof createSpecimenTypeSchema>) {
    return uniquely(
      () =>
        this.db.transaction(async (tx) => {
          const [row] = await tx
            .insert(labSpecimenType)
            .values({ ...input, organizationId: actor.organizationId })
            .returning();
          const created = found(row, "Specimen type");
          await this.audit.record(tx, actor, {
            action: "lab.specimen-type.create",
            resourceType: "lab_specimen_type",
            resourceId: created.id,
            metadata: { code: created.code },
          });
          return publicView(created);
        }),
      "A specimen type with that code exists",
      "duplicate_code",
    );
  }

  updateSpecimenType(actor: Actor, id: string, input: z.infer<typeof updateCatalogEntrySchema>) {
    return this.updateSimple(actor, labSpecimenType, "lab_specimen_type", "lab.specimen-type.update", "Specimen type", id, input);
  }

  // ---- Tests and reference ranges -------------------------------------------------------

  /** The catalog with each test's current (open) reference ranges. */
  async listTests(organizationId: string, includeInactive: boolean): Promise<TestView[]> {
    const tests = await this.db
      .select()
      .from(labTest)
      .where(and(eq(labTest.organizationId, organizationId), includeInactive ? undefined : eq(labTest.status, "active")))
      .orderBy(asc(labTest.name));
    return this.withRanges(this.db, tests, { currentOnly: true });
  }

  /** One test with its full range history. */
  async getTest(organizationId: string, testId: string): Promise<TestView> {
    const [row] = await this.db
      .select()
      .from(labTest)
      .where(and(eq(labTest.organizationId, organizationId), eq(labTest.id, testId)));
    const [view] = await this.withRanges(this.db, [found(row, "Laboratory test")], { currentOnly: false });
    return view!;
  }

  async createTest(actor: Actor, input: z.infer<typeof createTestSchema>): Promise<TestView> {
    try {
      return await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(labTest)
          .values({
            ...input,
            organizationId: actor.organizationId,
            codedValues: input.codedValues ?? [],
            abnormalCodedValues: input.abnormalCodedValues ?? [],
          })
          .returning();
        const created = found(row, "Laboratory test");
        await this.audit.record(tx, actor, {
          action: "lab.test.create",
          resourceType: "lab_test",
          resourceId: created.id,
          metadata: { code: created.code, resultType: created.resultType },
        });
        return { ...publicView(created), referenceRanges: [] };
      });
    } catch (error) {
      const pg = asPgError(error);
      if (pg?.code === PgErrorCode.uniqueViolation) throw new ConflictError("A test with that code exists", undefined, "duplicate_code");
      if (pg?.code === PgErrorCode.foreignKeyViolation) throw new NotFoundError("Laboratory department or specimen type");
      throw error;
    }
  }

  async updateTest(actor: Actor, testId: string, input: z.infer<typeof updateTestSchema>): Promise<TestView> {
    const { version, ...changes } = input;
    return this.db.transaction(async (tx) => {
      const current = await this.lockTest(tx, actor.organizationId, testId);
      assertVersion(current.version, version, "Laboratory test");
      const [updated] = await tx
        .update(labTest)
        .set({ ...changes, updatedAt: new Date(), version: sql`${labTest.version} + 1` })
        .where(eq(labTest.id, testId))
        .returning();
      await this.audit.record(tx, actor, {
        action: "lab.test.update",
        resourceType: "lab_test",
        resourceId: testId,
        changes: diffChanges(current, changes, TEST_FIELDS),
      });
      const [view] = await this.withRanges(tx, [found(updated, "Laboratory test")], { currentOnly: true });
      return view!;
    });
  }

  /**
   * Adds a reference range. An open range for the same sex and age band is
   * closed at the new range's start, so each result keeps the range that
   * applied when it was entered. Overlapping bands are refused by the database.
   */
  async addReferenceRange(actor: Actor, testId: string, input: z.infer<typeof addReferenceRangeSchema>) {
    const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : new Date();
    if (effectiveFrom.getTime() < Date.now() - 60_000) {
      throw new BusinessRuleError("Reference ranges take effect now or later; past results keep the range they were interpreted with", "range_in_past");
    }
    try {
      return await this.db.transaction(async (tx) => {
        const test = await this.lockTest(tx, actor.organizationId, testId);
        if (test.resultType !== "numeric" && (input.low !== null || input.high !== null || input.criticalLow !== null || input.criticalHigh !== null)) {
          throw new BusinessRuleError("Numeric limits apply to numeric tests only; use a text range", "range_not_numeric");
        }
        const sexMatch = input.sex === null ? isNull(labReferenceRange.sex) : eq(labReferenceRange.sex, input.sex);
        const ageMaxMatch = input.ageMaxDays === null ? isNull(labReferenceRange.ageMaxDays) : eq(labReferenceRange.ageMaxDays, input.ageMaxDays);
        const closed = await tx
          .update(labReferenceRange)
          .set({ effectiveTo: effectiveFrom })
          .where(
            and(
              eq(labReferenceRange.testId, testId),
              sexMatch,
              eq(labReferenceRange.ageMinDays, input.ageMinDays),
              ageMaxMatch,
              isNull(labReferenceRange.effectiveTo),
              sql`${labReferenceRange.effectiveFrom} < ${effectiveFrom}`,
            ),
          )
          .returning({ id: labReferenceRange.id });
        const [row] = await tx
          .insert(labReferenceRange)
          .values({ ...input, effectiveFrom, organizationId: actor.organizationId, testId, createdBy: actor.userId })
          .returning();
        const created = found(row, "Reference range");
        await this.audit.record(tx, actor, {
          action: "lab.reference-range.add",
          resourceType: "lab_test",
          resourceId: testId,
          metadata: { rangeId: created.id, replaces: closed.map((c) => c.id), code: test.code },
        });
        return publicView(created);
      });
    } catch (error) {
      if (asPgError(error)?.code === PgErrorCode.exclusionViolation) {
        throw new ConflictError("This range overlaps another range for the same sex and ages", undefined, "range_overlap");
      }
      throw error;
    }
  }

  // ---- Panels ---------------------------------------------------------------------------

  async listPanels(organizationId: string, includeInactive: boolean) {
    const panels = await this.db
      .select()
      .from(labPanel)
      .where(and(eq(labPanel.organizationId, organizationId), includeInactive ? undefined : eq(labPanel.status, "active")))
      .orderBy(asc(labPanel.name));
    if (panels.length === 0) return [];
    const members = await this.db
      .select({ panelId: labPanelTest.panelId, testId: labPanelTest.testId, position: labPanelTest.position })
      .from(labPanelTest)
      .where(
        inArray(
          labPanelTest.panelId,
          panels.map((p) => p.id),
        ),
      )
      .orderBy(asc(labPanelTest.position));
    return panels.map((p) => ({ ...publicView(p), testIds: members.filter((m) => m.panelId === p.id).map((m) => m.testId) }));
  }

  async createPanel(actor: Actor, input: z.infer<typeof createPanelSchema>) {
    const testIds = [...new Set(input.testIds)];
    try {
      return await this.db.transaction(async (tx) => {
        const tests = await tx
          .select({ id: labTest.id })
          .from(labTest)
          .where(and(eq(labTest.organizationId, actor.organizationId), inArray(labTest.id, testIds), eq(labTest.status, "active")));
        if (tests.length !== testIds.length) throw new NotFoundError("One or more active laboratory tests");
        const [row] = await tx.insert(labPanel).values({ organizationId: actor.organizationId, code: input.code, name: input.name }).returning();
        const created = found(row, "Laboratory panel");
        await tx
          .insert(labPanelTest)
          .values(testIds.map((testId, index) => ({ organizationId: actor.organizationId, panelId: created.id, testId, position: index + 1 })));
        await this.audit.record(tx, actor, {
          action: "lab.panel.create",
          resourceType: "lab_panel",
          resourceId: created.id,
          metadata: { code: created.code, tests: testIds.length },
        });
        return { ...publicView(created), testIds };
      });
    } catch (error) {
      if (asPgError(error)?.code === PgErrorCode.uniqueViolation) throw new ConflictError("A panel with that code exists", undefined, "duplicate_code");
      throw error;
    }
  }

  updatePanel(actor: Actor, id: string, input: z.infer<typeof updateCatalogEntrySchema>) {
    return this.updateSimple(actor, labPanel, "lab_panel", "lab.panel.update", "Laboratory panel", id, input);
  }

  // ---- Facility policy ------------------------------------------------------------------

  async policy(executor: DbExecutor, facilityId: string): Promise<Pick<LabFacilityPolicyRecord, PolicyFields>> {
    const [row] = await executor.select().from(labFacilityPolicy).where(eq(labFacilityPolicy.facilityId, facilityId));
    return row ?? DEFAULT_LAB_POLICY;
  }

  async getPolicy(actor: Actor, facilityId: string) {
    const [row] = await this.db
      .select()
      .from(labFacilityPolicy)
      .where(and(eq(labFacilityPolicy.organizationId, actor.organizationId), eq(labFacilityPolicy.facilityId, facilityId)));
    return row ? publicView(row) : { facilityId, ...DEFAULT_LAB_POLICY, version: 0 };
  }

  /** Relaxing separation of duties is a deliberate, audited facility decision with a reason. QC fields left out keep their value. */
  async setPolicy(actor: Actor, facilityId: string, input: z.infer<typeof facilityPolicySchema>) {
    const { reason, ...given } = input;
    return this.db.transaction(async (tx) => {
      const before = await this.policy(tx, facilityId);
      const values = {
        ...given,
        qcRejectRules: given.qcRejectRules ?? before.qcRejectRules,
        qcValidHours: given.qcValidHours ?? before.qcValidHours,
        qcRequired: given.qcRequired ?? before.qcRequired,
      };
      const [row] = await tx
        .insert(labFacilityPolicy)
        .values({ ...values, facilityId, organizationId: actor.organizationId, updatedBy: actor.userId })
        .onConflictDoUpdate({
          target: labFacilityPolicy.facilityId,
          set: { ...values, updatedBy: actor.userId, updatedAt: new Date(), version: sql`${labFacilityPolicy.version} + 1` },
          setWhere: eq(labFacilityPolicy.organizationId, actor.organizationId),
        })
        .returning();
      const saved = found(row, "Laboratory policy");
      await this.audit.record(tx, actor, {
        action: "lab.policy.update",
        resourceType: "facility",
        resourceId: facilityId,
        reason,
        changes: diffChanges(before, values, [
          "allowSelfVerification",
          "allowSelfApproval",
          "releaseOnApproval",
          "qcRejectRules",
          "qcValidHours",
          "qcRequired",
        ]),
      });
      return publicView(saved);
    });
  }

  // ---- internals ------------------------------------------------------------------------

  private async lockTest(tx: DbExecutor, organizationId: string, testId: string): Promise<LabTestRecord> {
    const [row] = await tx
      .select()
      .from(labTest)
      .where(and(eq(labTest.organizationId, organizationId), eq(labTest.id, testId)))
      .for("update");
    return found(row, "Laboratory test");
  }

  private async withRanges(executor: DbExecutor, tests: LabTestRecord[], options: { currentOnly: boolean }): Promise<TestView[]> {
    if (tests.length === 0) return [];
    const ranges = await executor
      .select()
      .from(labReferenceRange)
      .where(
        and(
          inArray(
            labReferenceRange.testId,
            tests.map((t) => t.id),
          ),
          options.currentOnly ? isNull(labReferenceRange.effectiveTo) : undefined,
        ),
      )
      .orderBy(asc(labReferenceRange.sex), asc(labReferenceRange.ageMinDays), asc(labReferenceRange.effectiveFrom));
    return tests.map((t) => ({ ...publicView(t), referenceRanges: ranges.filter((r) => r.testId === t.id).map(publicView) }));
  }

  private async updateSimple(
    actor: Actor,
    table: typeof labDepartment | typeof labSpecimenType | typeof labPanel,
    resourceType: string,
    action: string,
    label: string,
    id: string,
    input: z.infer<typeof updateCatalogEntrySchema>,
  ) {
    const { version, ...changes } = input;
    return this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(table)
        .where(and(eq(table.organizationId, actor.organizationId), eq(table.id, id)))
        .for("update");
      const current = found(before, label);
      assertVersion(current.version, version, label);
      const [updated] = await tx
        .update(table)
        .set({ ...changes, updatedAt: new Date(), version: sql`${table.version} + 1` })
        .where(eq(table.id, id))
        .returning();
      await this.audit.record(tx, actor, {
        action,
        resourceType,
        resourceId: id,
        changes: diffChanges(current, changes, ["name", "status"]),
      });
      return publicView(found(updated, label));
    });
  }
}
