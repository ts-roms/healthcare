import { Inject, Injectable } from "@nestjs/common";
import { AuditService, diffChanges } from "@healthcare/audit";
import { type Actor, DATABASE, type Database, type DbExecutor, NotFoundError } from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, asc, eq } from "drizzle-orm";
import type { z } from "zod";
import type { upsertWaitlistRuleSchema } from "../clinic.dto";
import { practitioner, visitType, waitlistRule, type WaitlistRuleRecord } from "../clinic.schema";
import { assertVersion } from "../clinic-support";
import { type BookingRules, resolveWaitlistRule, type WaitlistAllowance } from "../domain/patient-booking";
import { BookingRulesService } from "./booking-rules.service";

export interface WaitlistRuleView {
  id: string;
  facilityId: string;
  scope: "visit_type" | "practitioner";
  visitTypeId: string | null;
  visitTypeName: string | null;
  practitionerId: string | null;
  practitionerName: string | null;
  enabled: boolean;
  maxEntries: number;
  maxDaysAhead: number | null;
  version: number;
  updatedAt: string;
}

const FIELDS = ["enabled", "maxEntries", "maxDaysAhead"] as const;

/**
 * Waiting-list rules per visit type or practitioner at a facility (docs/domains/clinic.md, migration 0096): whether
 * patients may join, how many requests, how far ahead. The facility's own rule stays the default; a practitioner's
 * rule wins over a visit type's. Configuration only — the clinic decides, the platform applies.
 */
@Injectable()
export class WaitlistRulesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly organizations: OrganizationService,
    private readonly bookingRules: BookingRulesService,
  ) {}

  async list(actor: Actor, facilityId: string): Promise<WaitlistRuleView[]> {
    await this.organizations.getFacility(actor.organizationId, facilityId);
    const rows = await this.db
      .select({ rule: waitlistRule, visitTypeName: visitType.name, practitionerName: practitioner.displayName })
      .from(waitlistRule)
      .leftJoin(visitType, eq(visitType.id, waitlistRule.visitTypeId))
      .leftJoin(practitioner, eq(practitioner.id, waitlistRule.practitionerId))
      .where(and(eq(waitlistRule.organizationId, actor.organizationId), eq(waitlistRule.facilityId, facilityId)))
      .orderBy(asc(waitlistRule.scope), asc(waitlistRule.updatedAt));
    return rows.map((r) => view(r.rule, r.visitTypeName, r.practitionerName));
  }

  /** Sets (or first creates) the rule for one visit type or practitioner at a facility. */
  async upsert(actor: Actor, input: z.infer<typeof upsertWaitlistRuleSchema>): Promise<WaitlistRuleView> {
    await this.organizations.getFacility(actor.organizationId, input.facilityId);
    const target =
      input.scope === "visit_type"
        ? await this.db
            .select({ id: visitType.id, name: visitType.name })
            .from(visitType)
            .where(and(eq(visitType.organizationId, actor.organizationId), eq(visitType.id, input.visitTypeId!)))
        : await this.db
            .select({ id: practitioner.id, name: practitioner.displayName })
            .from(practitioner)
            .where(and(eq(practitioner.organizationId, actor.organizationId), eq(practitioner.id, input.practitionerId!)));
    if (!target[0]) throw new NotFoundError(input.scope === "visit_type" ? "Visit type" : "Practitioner");
    const fields = { enabled: input.enabled, maxEntries: input.maxEntries, maxDaysAhead: input.maxDaysAhead ?? null };
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(waitlistRule)
        .where(
          and(
            eq(waitlistRule.organizationId, actor.organizationId),
            eq(waitlistRule.facilityId, input.facilityId),
            eq(waitlistRule.scope, input.scope),
            input.scope === "visit_type" ? eq(waitlistRule.visitTypeId, input.visitTypeId!) : eq(waitlistRule.practitionerId, input.practitionerId!),
          ),
        )
        .for("update");
      if (current) assertVersion(current.version, input.version ?? -1, "Waiting-list rule");
      const [saved] = current
        ? await tx
            .update(waitlistRule)
            .set({ ...fields, updatedBy: actor.userId, updatedAt: new Date(), version: current.version + 1 })
            .where(eq(waitlistRule.id, current.id))
            .returning()
        : await tx
            .insert(waitlistRule)
            .values({
              ...fields,
              organizationId: actor.organizationId,
              facilityId: input.facilityId,
              scope: input.scope,
              visitTypeId: input.visitTypeId ?? null,
              practitionerId: input.practitionerId ?? null,
              updatedBy: actor.userId,
            })
            .returning();
      await this.audit.record(tx, actor, {
        action: "facility.waitlist-rule-update",
        resourceType: "waitlist_rule",
        resourceId: saved!.id,
        changes: diffChanges(current ? { enabled: current.enabled, maxEntries: current.maxEntries, maxDaysAhead: current.maxDaysAhead } : {}, fields, FIELDS),
        metadata: { facilityId: input.facilityId, scope: input.scope, visitTypeId: input.visitTypeId ?? null, practitionerId: input.practitionerId ?? null },
      });
      return view(saved!, input.scope === "visit_type" ? target[0].name : null, input.scope === "practitioner" ? target[0].name : null);
    });
  }

  /** The rules of one facility, for resolving requests. */
  async rulesOf(organizationId: string, facilityId: string, executor: DbExecutor = this.db): Promise<WaitlistRuleRecord[]> {
    return executor
      .select()
      .from(waitlistRule)
      .where(and(eq(waitlistRule.organizationId, organizationId), eq(waitlistRule.facilityId, facilityId)));
  }

  /** What a request for this visit type and practitioner is allowed at the facility (the facility's rules included). */
  async allowance(
    organizationId: string,
    facilityId: string,
    request: { visitTypeId: string | null; practitionerId: string | null },
    facilityRules?: BookingRules,
    executor: DbExecutor = this.db,
  ): Promise<WaitlistAllowance> {
    const rules = facilityRules ?? (await this.bookingRules.forFacility(organizationId, facilityId, executor));
    return resolveWaitlistRule(rules, await this.rulesOf(organizationId, facilityId, executor), request);
  }
}

function view(row: WaitlistRuleRecord, visitTypeName: string | null, practitionerName: string | null): WaitlistRuleView {
  return {
    id: row.id,
    facilityId: row.facilityId,
    scope: row.scope,
    visitTypeId: row.visitTypeId,
    visitTypeName,
    practitionerId: row.practitionerId,
    practitionerName,
    enabled: row.enabled,
    maxEntries: row.maxEntries,
    maxDaysAhead: row.maxDaysAhead,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}
