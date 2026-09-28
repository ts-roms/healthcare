import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { type Actor, BusinessRuleError, DATABASE, type Database, type DbExecutor, ForbiddenError, localDate, requireFacilityId } from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, desc, eq } from "drizzle-orm";
import type { z } from "zod";
import { LabCatalogService } from "../catalog/lab-catalog.service";
import { labDepartment, labTest } from "../laboratory.schema";
import { found, publicView } from "../laboratory-support";
import { LABORATORY_CONTEXT, type LaboratoryContext } from "../ports";
import type { recordCompetencySchema } from "./quality-management.dto";
import { competencyFor } from "./quality-management.rules";
import { labCompetencyAssessment, type LabCompetencyAssessmentRecord } from "./quality-management.schema";

/**
 * Staff competency: assessments of result-entering staff for a test or a
 * whole department (method, outcome, next due date), append-only — the latest
 * counts. With the facility policy `competency_required`, result entry checks
 * that the person has a current "competent" assessment for the test (or its
 * department). The areas and intervals are the laboratory's own.
 */
@Injectable()
export class LabCompetencyService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(LABORATORY_CONTEXT) private readonly context: LaboratoryContext,
    private readonly catalog: LabCatalogService,
    private readonly organizations: OrganizationService,
    private readonly audit: AuditService,
  ) {}

  /** Result-entering staff at the selected facility, each with their latest assessment per area. */
  async overview(actor: Actor) {
    const facilityId = requireFacilityId(actor);
    const [staff, assessments, today, policy] = await Promise.all([
      this.context.laboratoryStaff(actor.organizationId, facilityId),
      this.db
        .select()
        .from(labCompetencyAssessment)
        .where(and(eq(labCompetencyAssessment.organizationId, actor.organizationId), eq(labCompetencyAssessment.facilityId, facilityId)))
        .orderBy(desc(labCompetencyAssessment.assessedOn), desc(labCompetencyAssessment.recordedAt)),
      this.today(actor.organizationId, facilityId),
      this.catalog.policy(this.db, facilityId),
    ]);
    const names = await this.context.staffNames(actor.organizationId, [...new Set(assessments.map((a) => a.assessedBy))]);
    return {
      competencyRequired: policy.competencyRequired,
      staff: staff.map((person) => {
        const own = assessments.filter((a) => a.userId === person.id);
        // Latest per area (test or department): the list is newest first.
        const latest = new Map<string, LabCompetencyAssessmentRecord>();
        for (const a of own) {
          const key = a.testId ? `test:${a.testId}` : `department:${a.departmentId}`;
          if (!latest.has(key)) latest.set(key, a);
        }
        return {
          userId: person.id,
          displayName: person.displayName,
          areas: [...latest.values()].map((a) => ({
            ...publicView(a),
            assessedByName: names.get(a.assessedBy) ?? null,
            state: a.outcome !== "competent" ? "not_yet_competent" : a.nextDueOn !== null && a.nextDueOn < today ? "due" : "competent",
          })),
        };
      }),
    };
  }

  async history(actor: Actor, userId: string) {
    const rows = await this.db
      .select()
      .from(labCompetencyAssessment)
      .where(and(eq(labCompetencyAssessment.organizationId, actor.organizationId), eq(labCompetencyAssessment.userId, userId)))
      .orderBy(desc(labCompetencyAssessment.assessedOn), desc(labCompetencyAssessment.recordedAt))
      .limit(200);
    const names = await this.context.staffNames(actor.organizationId, [...new Set(rows.map((r) => r.assessedBy))]);
    return rows.map((r) => ({ ...publicView(r), assessedByName: names.get(r.assessedBy) ?? null }));
  }

  async record(actor: Actor, input: z.infer<typeof recordCompetencySchema>) {
    const facilityId = requireFacilityId(actor);
    if (input.userId === actor.userId) throw new ForbiddenError("Staff do not assess their own competency");
    const today = await this.today(actor.organizationId, facilityId);
    if (input.assessedOn > today) throw new BusinessRuleError("The assessment date cannot be in the future", "assessed_in_future");
    const staff = await this.context.laboratoryStaff(actor.organizationId, facilityId);
    if (!staff.some((s) => s.id === input.userId)) {
      throw new BusinessRuleError("Competency is recorded for staff who enter results at this facility", "not_laboratory_staff");
    }
    return this.db.transaction(async (tx) => {
      if (input.testId) {
        const [test] = await tx
          .select({ id: labTest.id })
          .from(labTest)
          .where(and(eq(labTest.organizationId, actor.organizationId), eq(labTest.id, input.testId)));
        found(test, "Laboratory test");
      }
      if (input.departmentId) {
        const [department] = await tx
          .select({ id: labDepartment.id })
          .from(labDepartment)
          .where(and(eq(labDepartment.organizationId, actor.organizationId), eq(labDepartment.id, input.departmentId)));
        found(department, "Laboratory department");
      }
      const [row] = await tx
        .insert(labCompetencyAssessment)
        .values({
          organizationId: actor.organizationId,
          facilityId,
          userId: input.userId,
          testId: input.testId ?? null,
          departmentId: input.departmentId ?? null,
          method: input.method,
          outcome: input.outcome,
          assessedOn: input.assessedOn,
          nextDueOn: input.nextDueOn ?? null,
          notes: input.notes ?? null,
          assessedBy: actor.userId,
        })
        .returning();
      const assessment = found(row, "Competency assessment");
      await this.audit.record(tx, actor, {
        action: "lab.competency.record",
        resourceType: "lab_competency_assessment",
        resourceId: assessment.id,
        metadata: { userId: input.userId, testId: input.testId, departmentId: input.departmentId, outcome: input.outcome, nextDueOn: input.nextDueOn },
      });
      return publicView(assessment);
    });
  }

  /**
   * For result entry: when the facility requires it, the person entering must have a current "competent" assessment
   * for the test or its department.
   */
  async assertCompetent(tx: DbExecutor, actor: Actor, facilityId: string, test: { id: string; departmentId: string; name: string }): Promise<void> {
    const policy = await this.catalog.policy(tx, facilityId);
    if (!policy.competencyRequired) return;
    const [assessments, today] = await Promise.all([
      tx
        .select()
        .from(labCompetencyAssessment)
        .where(
          and(
            eq(labCompetencyAssessment.organizationId, actor.organizationId),
            eq(labCompetencyAssessment.facilityId, facilityId),
            eq(labCompetencyAssessment.userId, actor.userId),
          ),
        ),
      this.today(actor.organizationId, facilityId),
    ]);
    const { state } = competencyFor(assessments, test, today);
    if (state === "competent") return;
    const why =
      state === "due"
        ? "your competency assessment is due"
        : state === "not_yet_competent"
          ? "your latest assessment was not yet competent"
          : "no competency assessment is recorded";
    throw new BusinessRuleError(`You cannot enter ${test.name} results at this facility: ${why}. Ask your section head.`, "competency_required");
  }

  private async today(organizationId: string, facilityId: string): Promise<string> {
    const facility = await this.organizations.getFacility(organizationId, facilityId);
    return localDate(new Date(), facility.timezone);
  }
}
