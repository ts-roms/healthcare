import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { type Actor, BusinessRuleError, DATABASE, type Database, DomainEventPublisher, requireFacilityId } from "@healthcare/core";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { z } from "zod";
import { labTest } from "../laboratory.schema";
import { found, publicView, uniquely } from "../laboratory-support";
import { LABORATORY_CONTEXT, type LaboratoryContext } from "../ports";
import { LabNonconformanceService } from "./lab-nonconformance.service";
import type { createEqaSchemeSchema, createEqaSurveySchema, eqaEvaluationSchema, reportEqaResultSchema } from "./quality-management.dto";
import { labEqaResult, labEqaScheme, labEqaSurvey, labNonconformance } from "./quality-management.schema";

/**
 * External quality assessment (proficiency testing): schemes (provider and
 * programme as recorded), rounds received at a facility, the results the
 * laboratory reported, and the provider's evaluation — recorded as the
 * provider gave it, never computed here. An unacceptable result opens a
 * nonconformance (category eqa_failure) for investigation.
 */
@Injectable()
export class LabEqaService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(LABORATORY_CONTEXT) private readonly context: LaboratoryContext,
    private readonly nonconformances: LabNonconformanceService,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
  ) {}

  schemes(actor: Actor) {
    return this.db.select().from(labEqaScheme).where(eq(labEqaScheme.organizationId, actor.organizationId)).orderBy(asc(labEqaScheme.name));
  }

  async createScheme(actor: Actor, input: z.infer<typeof createEqaSchemeSchema>) {
    return this.db.transaction(async (tx) => {
      const [row] = await uniquely(
        () =>
          tx
            .insert(labEqaScheme)
            .values({ organizationId: actor.organizationId, ...input })
            .returning(),
        "A scheme with this code already exists",
        "duplicate_code",
      );
      const scheme = found(row, "EQA scheme");
      await this.audit.record(tx, actor, { action: "lab.eqa.scheme.create", resourceType: "lab_eqa_scheme", resourceId: scheme.id, metadata: input });
      return publicView(scheme);
    });
  }

  /** Rounds at the selected facility, newest first, with their results and any nonconformance they opened. */
  async surveys(actor: Actor) {
    const facilityId = requireFacilityId(actor);
    const surveys = await this.db
      .select({ survey: labEqaSurvey, scheme: labEqaScheme })
      .from(labEqaSurvey)
      .innerJoin(labEqaScheme, eq(labEqaScheme.id, labEqaSurvey.schemeId))
      .where(and(eq(labEqaSurvey.organizationId, actor.organizationId), eq(labEqaSurvey.facilityId, facilityId)))
      .orderBy(desc(labEqaSurvey.receivedOn))
      .limit(100);
    if (surveys.length === 0) return [];
    const results = await this.db
      .select({ result: labEqaResult, testName: labTest.name, nonconformanceId: labNonconformance.id, nonconformanceNumber: labNonconformance.number })
      .from(labEqaResult)
      .innerJoin(labTest, eq(labTest.id, labEqaResult.testId))
      .leftJoin(labNonconformance, eq(labNonconformance.eqaResultId, labEqaResult.id))
      .where(
        inArray(
          labEqaResult.surveyId,
          surveys.map((s) => s.survey.id),
        ),
      )
      .orderBy(asc(labEqaResult.sampleCode), asc(labTest.name));
    const names = await this.context.staffNames(actor.organizationId, [
      ...new Set(results.flatMap((r) => [r.result.reportedBy, r.result.evaluatedBy]).filter((id): id is string => !!id)),
    ]);
    return surveys.map(({ survey, scheme }) => {
      const rows = results.filter((r) => r.result.surveyId === survey.id);
      return {
        ...publicView(survey),
        scheme: { id: scheme.id, code: scheme.code, provider: scheme.provider, name: scheme.name },
        status: rows.length === 0 ? "received" : rows.every((r) => r.result.evaluation) ? "evaluated" : "reported",
        results: rows.map((r) => ({
          ...publicView(r.result),
          testName: r.testName,
          reportedByName: names.get(r.result.reportedBy) ?? null,
          evaluatedByName: r.result.evaluatedBy ? (names.get(r.result.evaluatedBy) ?? null) : null,
          nonconformance: r.nonconformanceId ? { id: r.nonconformanceId, number: r.nonconformanceNumber } : null,
        })),
      };
    });
  }

  async createSurvey(actor: Actor, input: z.infer<typeof createEqaSurveySchema>) {
    const facilityId = requireFacilityId(actor);
    if (input.dueOn && input.dueOn < input.receivedOn) throw new BusinessRuleError("The due date is before the date received", "invalid_due_date");
    return this.db.transaction(async (tx) => {
      const [scheme] = await tx
        .select()
        .from(labEqaScheme)
        .where(and(eq(labEqaScheme.organizationId, actor.organizationId), eq(labEqaScheme.id, input.schemeId)));
      if (found(scheme, "EQA scheme").status !== "active") throw new BusinessRuleError("The scheme is inactive", "eqa_scheme_inactive");
      const [row] = await uniquely(
        () =>
          tx
            .insert(labEqaSurvey)
            .values({ organizationId: actor.organizationId, facilityId, ...input, dueOn: input.dueOn ?? null, createdBy: actor.userId })
            .returning(),
        "This round is already recorded",
        "duplicate_round",
      );
      const survey = found(row, "EQA round");
      await this.audit.record(tx, actor, { action: "lab.eqa.survey.create", resourceType: "lab_eqa_survey", resourceId: survey.id, metadata: input });
      return publicView(survey);
    });
  }

  async report(actor: Actor, surveyId: string, input: z.infer<typeof reportEqaResultSchema>) {
    const facilityId = requireFacilityId(actor);
    return this.db.transaction(async (tx) => {
      const [survey] = await tx
        .select()
        .from(labEqaSurvey)
        .where(and(eq(labEqaSurvey.organizationId, actor.organizationId), eq(labEqaSurvey.id, surveyId)));
      if (found(survey, "EQA round").facilityId !== facilityId) throw new BusinessRuleError("This round belongs to another facility", "wrong_facility");
      const [test] = await tx
        .select({ id: labTest.id })
        .from(labTest)
        .where(and(eq(labTest.organizationId, actor.organizationId), eq(labTest.id, input.testId)));
      found(test, "Laboratory test");
      const [row] = await uniquely(
        () =>
          tx
            .insert(labEqaResult)
            .values({ organizationId: actor.organizationId, surveyId, ...input, reportedBy: actor.userId })
            .returning(),
        "A result for this sample and test is already reported",
        "duplicate_eqa_result",
      );
      const result = found(row, "EQA result");
      await this.audit.record(tx, actor, {
        action: "lab.eqa.result.report",
        resourceType: "lab_eqa_survey",
        resourceId: surveyId,
        metadata: { resultId: result.id, testId: input.testId, sampleCode: input.sampleCode },
      });
      return publicView(result);
    });
  }

  /** Records the provider's evaluation once; an unacceptable result opens a nonconformance. */
  async evaluate(actor: Actor, resultId: string, input: z.infer<typeof eqaEvaluationSchema>) {
    const facilityId = requireFacilityId(actor);
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select({ result: labEqaResult, survey: labEqaSurvey, scheme: labEqaScheme, testName: labTest.name })
        .from(labEqaResult)
        .innerJoin(labEqaSurvey, eq(labEqaSurvey.id, labEqaResult.surveyId))
        .innerJoin(labEqaScheme, eq(labEqaScheme.id, labEqaSurvey.schemeId))
        .innerJoin(labTest, eq(labTest.id, labEqaResult.testId))
        .where(and(eq(labEqaResult.organizationId, actor.organizationId), eq(labEqaResult.id, resultId)))
        .for("update", { of: labEqaResult });
      const { result, survey, scheme, testName } = found(current, "EQA result");
      if (survey.facilityId !== facilityId) throw new BusinessRuleError("This round belongs to another facility", "wrong_facility");
      const [row] = await tx
        .update(labEqaResult)
        .set({
          evaluation: input.evaluation,
          targetValue: input.targetValue ?? null,
          providerScore: input.providerScore ?? null,
          evaluationNote: input.note ?? null,
          evaluatedAt: new Date(),
          evaluatedBy: actor.userId,
        })
        .where(and(eq(labEqaResult.id, resultId), isNull(labEqaResult.evaluatedAt)))
        .returning();
      if (!row) throw new BusinessRuleError("The evaluation is already recorded", "eqa_already_evaluated");
      let nonconformanceId: string | null = null;
      if (input.evaluation === "unacceptable") {
        const opened = await this.nonconformances.openFromPlatform(tx, actor, {
          facilityId,
          category: "eqa_failure",
          severity: "major",
          title: `Unacceptable EQA result: ${testName}, ${scheme.name} ${survey.roundCode}`,
          description: `Sample ${result.sampleCode}: reported ${result.reportedValue}${input.targetValue ? `, target ${input.targetValue}` : ""}${
            input.providerScore ? `, provider score ${input.providerScore}` : ""
          } (${scheme.provider}).${input.note ? ` ${input.note}` : ""}`,
          occurredAt: new Date(),
          eqaResultId: resultId,
        });
        nonconformanceId = opened.id;
        await this.events.record(tx, {
          type: "LaboratoryEqaResultUnacceptable",
          organizationId: actor.organizationId,
          aggregateType: "lab_eqa_survey",
          aggregateId: survey.id,
          facilityId,
          payload: { resultId, testId: result.testId, nonconformanceId },
        });
      }
      await this.audit.record(tx, actor, {
        action: "lab.eqa.result.evaluate",
        resourceType: "lab_eqa_survey",
        resourceId: survey.id,
        metadata: { resultId, evaluation: input.evaluation, nonconformanceId },
      });
      return { ...publicView(row), nonconformanceId };
    });
  }
}
