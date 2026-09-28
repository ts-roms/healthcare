import { Inject, Injectable } from "@nestjs/common";
import { AuditService, diffChanges } from "@healthcare/audit";
import { type Actor, BusinessRuleError, DATABASE, type Database, type DbExecutor, NotFoundError } from "@healthcare/core";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import { labTest } from "../laboratory.schema";
import { assertVersion, found, publicView, uniquely } from "../laboratory-support";
import type { createReferenceLabSchema, setReferralSchema, updateReferenceLabSchema } from "./send-out.dto";
import { labReferenceLaboratory, type LabReferenceLaboratoryRecord, labTestReferral, type LabTestReferralRecord } from "./send-out.schema";

const LAB_FIELDS = ["name", "contactName", "phone", "email", "address", "accreditationReference", "notes", "status"] as const;

/**
 * Reference laboratories the organization sends tests to, and which tests each facility's laboratory refers out
 * (organization configuration; every change is audited). The accreditation / licence reference is what staff record;
 * the platform does not verify it with any regulator.
 */
@Injectable()
export class ReferenceLabService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string, includeInactive: boolean) {
    const rows = await this.db
      .select()
      .from(labReferenceLaboratory)
      .where(and(eq(labReferenceLaboratory.organizationId, organizationId), includeInactive ? undefined : eq(labReferenceLaboratory.status, "active")))
      .orderBy(asc(labReferenceLaboratory.name));
    return rows.map(publicView);
  }

  create(actor: Actor, input: z.infer<typeof createReferenceLabSchema>) {
    return uniquely(
      () =>
        this.db.transaction(async (tx) => {
          const [row] = await tx
            .insert(labReferenceLaboratory)
            .values({
              organizationId: actor.organizationId,
              code: input.code,
              name: input.name,
              contactName: input.contactName ?? null,
              phone: input.phone ?? null,
              email: input.email ?? null,
              address: input.address ?? null,
              accreditationReference: input.accreditationReference ?? null,
              notes: input.notes ?? null,
            })
            .returning();
          const created = found(row, "Reference laboratory");
          await this.audit.record(tx, actor, {
            action: "lab.reference-lab.create",
            resourceType: "lab_reference_laboratory",
            resourceId: created.id,
            metadata: { code: created.code, name: created.name, accreditationReference: created.accreditationReference },
          });
          return publicView(created);
        }),
      "A reference laboratory with this code already exists",
      "duplicate_code",
    );
  }

  async update(actor: Actor, id: string, input: z.infer<typeof updateReferenceLabSchema>) {
    const { version, ...changes } = input;
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(labReferenceLaboratory)
        .where(and(eq(labReferenceLaboratory.organizationId, actor.organizationId), eq(labReferenceLaboratory.id, id)))
        .for("update");
      const before = found(current, "Reference laboratory");
      assertVersion(before.version, version, "Reference laboratory");
      const values = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
      const [row] = await tx
        .update(labReferenceLaboratory)
        .set({ ...values, updatedAt: new Date(), version: before.version + 1 })
        .where(eq(labReferenceLaboratory.id, id))
        .returning();
      const updated = found(row, "Reference laboratory");
      await this.audit.record(tx, actor, {
        action: "lab.reference-lab.update",
        resourceType: "lab_reference_laboratory",
        resourceId: id,
        changes: diffChanges(before, updated, [...LAB_FIELDS]),
      });
      return publicView(updated);
    });
  }

  /** The selected facility's referred tests, with the test and reference laboratory names. */
  async referrals(organizationId: string, facilityId: string) {
    const rows = await this.db
      .select({
        referral: labTestReferral,
        testCode: labTest.code,
        testName: labTest.name,
        testTurnaroundMinutes: labTest.turnaroundMinutes,
        lab: labReferenceLaboratory,
      })
      .from(labTestReferral)
      .innerJoin(labTest, eq(labTest.id, labTestReferral.testId))
      .innerJoin(labReferenceLaboratory, eq(labReferenceLaboratory.id, labTestReferral.referenceLaboratoryId))
      .where(and(eq(labTestReferral.organizationId, organizationId), eq(labTestReferral.facilityId, facilityId)))
      .orderBy(asc(labTest.name));
    return rows.map(({ referral, testCode, testName, testTurnaroundMinutes, lab }) => ({
      ...publicView(referral),
      testCode,
      testName,
      testTurnaroundMinutes,
      referenceLaboratoryName: lab.name,
      referenceLaboratoryStatus: lab.status,
    }));
  }

  /** Refers a test out from the facility to an active reference laboratory (replacing an earlier referral). */
  async setReferral(actor: Actor, facilityId: string, testId: string, input: z.infer<typeof setReferralSchema>) {
    return this.db.transaction(async (tx) => {
      const [test] = await tx
        .select({ id: labTest.id })
        .from(labTest)
        .where(and(eq(labTest.organizationId, actor.organizationId), eq(labTest.id, testId)));
      found(test, "Laboratory test");
      await this.activeLab(tx, actor.organizationId, input.referenceLaboratoryId);
      const [before] = await tx
        .select()
        .from(labTestReferral)
        .where(and(eq(labTestReferral.facilityId, facilityId), eq(labTestReferral.testId, testId)))
        .for("update");
      const values = { referenceLaboratoryId: input.referenceLaboratoryId, turnaroundMinutes: input.turnaroundMinutes ?? null };
      const [row] = await tx
        .insert(labTestReferral)
        .values({ ...values, facilityId, organizationId: actor.organizationId, testId, updatedBy: actor.userId })
        .onConflictDoUpdate({
          target: [labTestReferral.facilityId, labTestReferral.testId],
          set: { ...values, updatedBy: actor.userId, updatedAt: new Date(), version: sql`${labTestReferral.version} + 1` },
          setWhere: eq(labTestReferral.organizationId, actor.organizationId),
        })
        .returning();
      const saved = found(row, "Test referral");
      await this.audit.record(tx, actor, {
        action: "lab.referral.set",
        resourceType: "lab_test",
        resourceId: testId,
        changes: diffChanges(before ?? { referenceLaboratoryId: null, turnaroundMinutes: null }, values, ["referenceLaboratoryId", "turnaroundMinutes"]),
        metadata: { facilityId },
      });
      return publicView(saved);
    });
  }

  /** The facility performs the test itself again (or does not offer it). Tests already sent out are not affected. */
  async removeReferral(actor: Actor, facilityId: string, testId: string, reason: string) {
    await this.db.transaction(async (tx) => {
      const [removed] = await tx
        .delete(labTestReferral)
        .where(and(eq(labTestReferral.organizationId, actor.organizationId), eq(labTestReferral.facilityId, facilityId), eq(labTestReferral.testId, testId)))
        .returning();
      if (!removed) throw new NotFoundError("Test referral");
      await this.audit.record(tx, actor, {
        action: "lab.referral.remove",
        resourceType: "lab_test",
        resourceId: testId,
        reason,
        changes: { referenceLaboratoryId: { from: removed.referenceLaboratoryId, to: null } },
        metadata: { facilityId },
      });
    });
    return { removed: true };
  }

  /** The facility's referral for these tests (only to active reference laboratories). */
  async referralsFor(executor: DbExecutor, facilityId: string, testIds: string[]): Promise<Map<string, LabTestReferralRecord & { name: string }>> {
    if (testIds.length === 0) return new Map();
    const rows = await executor
      .select({ referral: labTestReferral, name: labReferenceLaboratory.name })
      .from(labTestReferral)
      .innerJoin(labReferenceLaboratory, eq(labReferenceLaboratory.id, labTestReferral.referenceLaboratoryId))
      .where(and(eq(labTestReferral.facilityId, facilityId), eq(labReferenceLaboratory.status, "active"), inArray(labTestReferral.testId, testIds)));
    return new Map(rows.map((r) => [r.referral.testId, { ...r.referral, name: r.name }]));
  }

  async activeLab(executor: DbExecutor, organizationId: string, id: string): Promise<LabReferenceLaboratoryRecord> {
    const [row] = await executor
      .select()
      .from(labReferenceLaboratory)
      .where(and(eq(labReferenceLaboratory.organizationId, organizationId), eq(labReferenceLaboratory.id, id)));
    const lab = found(row, "Reference laboratory");
    if (lab.status !== "active") throw new BusinessRuleError(`${lab.name} is inactive`, "reference_laboratory_inactive");
    return lab;
  }
}
