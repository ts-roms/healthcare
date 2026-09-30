import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { type Actor, BusinessRuleError, ConflictError, DATABASE, type Database, NotFoundError, VersionConflictError } from "@healthcare/core";
import { and, asc, eq } from "drizzle-orm";
import type { z } from "zod";
import type { createRuleSchema, facilityCodeSchema } from "./doh.dto";
import { dohFacilitySetting, dohReportableRule, type FacilitySettingRecord, type ReportableRuleRecord } from "./doh.schema";

/**
 * Which diagnoses the organization reports (its own configuration, from the
 * official issuances it follows) and each facility's DOH health facility code.
 */
@Injectable()
export class DohSettingsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async rules(organizationId: string, activeOnly = false): Promise<ReportableRuleRecord[]> {
    const conditions = [eq(dohReportableRule.organizationId, organizationId)];
    if (activeOnly) conditions.push(eq(dohReportableRule.status, "active"));
    return this.db
      .select()
      .from(dohReportableRule)
      .where(and(...conditions))
      .orderBy(asc(dohReportableRule.codePrefix));
  }

  async createRule(actor: Actor, input: z.infer<typeof createRuleSchema>) {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: dohReportableRule.id })
        .from(dohReportableRule)
        .where(
          and(
            eq(dohReportableRule.organizationId, actor.organizationId),
            eq(dohReportableRule.codePrefix, input.codePrefix),
            eq(dohReportableRule.status, "active"),
          ),
        );
      if (existing) throw new ConflictError(`An active rule for ${input.codePrefix} exists`, undefined, "rule_exists");
      const [row] = (await tx
        .insert(dohReportableRule)
        .values({
          organizationId: actor.organizationId,
          codePrefix: input.codePrefix,
          category: input.category,
          sourceNote: input.sourceNote ?? null,
          reportWithinDays: input.reportWithinDays ?? null,
          createdBy: actor.userId,
        })
        .returning()) as [ReportableRuleRecord];
      await this.audit.record(tx, actor, {
        action: "doh.rule.create",
        resourceType: "doh_reportable_rule",
        resourceId: row.id,
        metadata: { codePrefix: row.codePrefix, category: row.category, reportWithinDays: row.reportWithinDays },
      });
      return strip(row);
    });
  }

  /** Rules are not edited: a change is a deactivation and a new rule (case reports keep the rule they matched). */
  async deactivateRule(actor: Actor, ruleId: string) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(dohReportableRule)
        .where(and(eq(dohReportableRule.organizationId, actor.organizationId), eq(dohReportableRule.id, ruleId)))
        .for("update");
      if (!row) throw new NotFoundError("Reportable condition rule");
      if (row.status === "inactive") throw new BusinessRuleError("The rule is already inactive", "rule_inactive");
      const [updated] = (await tx.update(dohReportableRule).set({ status: "inactive" }).where(eq(dohReportableRule.id, ruleId)).returning()) as [
        ReportableRuleRecord,
      ];
      await this.audit.record(tx, actor, {
        action: "doh.rule.deactivate",
        resourceType: "doh_reportable_rule",
        resourceId: ruleId,
        metadata: { codePrefix: row.codePrefix },
      });
      return strip(updated);
    });
  }

  async facilityCode(organizationId: string, facilityId: string): Promise<FacilitySettingRecord | null> {
    const [row] = await this.db
      .select()
      .from(dohFacilitySetting)
      .where(and(eq(dohFacilitySetting.organizationId, organizationId), eq(dohFacilitySetting.facilityId, facilityId)));
    return row ?? null;
  }

  async recordFacilityCode(actor: Actor, facilityId: string, input: z.infer<typeof facilityCodeSchema>) {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(dohFacilitySetting)
        .where(and(eq(dohFacilitySetting.organizationId, actor.organizationId), eq(dohFacilitySetting.facilityId, facilityId)))
        .for("update");
      let saved: FacilitySettingRecord;
      if (current) {
        if (input.version !== current.version) throw new VersionConflictError("DOH facility code", input.version ?? 0);
        [saved] = (await tx
          .update(dohFacilitySetting)
          .set({ facilityCode: input.facilityCode, updatedBy: actor.userId, updatedAt: new Date(), version: current.version + 1 })
          .where(eq(dohFacilitySetting.id, current.id))
          .returning()) as [FacilitySettingRecord];
      } else {
        // The facility must belong to the organization (composite foreign key).
        [saved] = (await tx
          .insert(dohFacilitySetting)
          .values({ organizationId: actor.organizationId, facilityId, facilityCode: input.facilityCode, updatedBy: actor.userId })
          .returning()) as [FacilitySettingRecord];
      }
      await this.audit.record(tx, actor, {
        action: "doh.facility-code.record",
        resourceType: "facility",
        resourceId: facilityId,
        changes: { facilityCode: { from: current?.facilityCode ?? null, to: saved.facilityCode } },
      });
      return strip(saved);
    });
  }
}

export function strip<T extends { organizationId: string }>(row: T): Omit<T, "organizationId"> {
  const { organizationId: _o, ...rest } = row;
  return rest;
}
