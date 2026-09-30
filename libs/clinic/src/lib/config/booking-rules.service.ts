import { Inject, Injectable } from "@nestjs/common";
import { AuditService, diffChanges } from "@healthcare/audit";
import { type Actor, DATABASE, type Database, type DbExecutor, NotFoundError } from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import type { updateBookingRulesSchema } from "../clinic.dto";
import { facilityBookingRule } from "../clinic.schema";
import { assertVersion } from "../clinic-support";
import { type BookingRules, DEFAULT_BOOKING_RULES } from "../domain/patient-booking";

const FIELDS = ["minLeadMinutes", "maxAdvanceDays", "maxUpcoming", "changeCutoffMinutes", "waitlistEnabled", "maxWaitlistEntries"] as const;

export interface FacilityBookingRules {
  facilityId: string;
  facilityName: string;
  /** The clinic set its own rules (otherwise the platform's defaults apply). */
  customized: boolean;
  rules: BookingRules;
  version: number | null;
  updatedAt: string | null;
}

const toRules = (row: typeof facilityBookingRule.$inferSelect): BookingRules => ({
  minLeadMinutes: row.minLeadMinutes,
  maxAdvanceDays: row.maxAdvanceDays,
  maxUpcoming: row.maxUpcoming,
  changeCutoffMinutes: row.changeCutoffMinutes,
  waitlistEnabled: row.waitlistEnabled,
  maxWaitlistEntries: row.maxWaitlistEntries,
});

/**
 * Online booking rules per facility (docs/domains/clinic.md, "Online booking rules and the waiting list"): notice,
 * horizon, open-booking limit, change cut-off and whether patients may join a waiting list. A facility without a row
 * uses the platform's defaults, so nothing changes until a clinic sets its own.
 */
@Injectable()
export class BookingRulesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly organizations: OrganizationService,
  ) {}

  /** The rules of one facility. */
  async forFacility(organizationId: string, facilityId: string, executor: DbExecutor = this.db): Promise<BookingRules> {
    const [row] = await executor
      .select()
      .from(facilityBookingRule)
      .where(and(eq(facilityBookingRule.organizationId, organizationId), eq(facilityBookingRule.facilityId, facilityId)));
    return row ? toRules(row) : DEFAULT_BOOKING_RULES;
  }

  /** The rules of several facilities (a facility without its own row is given the defaults). */
  async forFacilities(organizationId: string, facilityIds: string[]): Promise<Map<string, BookingRules>> {
    const result = new Map<string, BookingRules>(facilityIds.map((id) => [id, DEFAULT_BOOKING_RULES]));
    if (facilityIds.length === 0) return result;
    const rows = await this.db
      .select()
      .from(facilityBookingRule)
      .where(and(eq(facilityBookingRule.organizationId, organizationId), inArray(facilityBookingRule.facilityId, facilityIds)));
    for (const row of rows) result.set(row.facilityId, toRules(row));
    return result;
  }

  async list(actor: Actor): Promise<FacilityBookingRules[]> {
    const facilities = (await this.organizations.listFacilities(actor.organizationId)).filter((f) => f.status === "active");
    const rows = await this.db.select().from(facilityBookingRule).where(eq(facilityBookingRule.organizationId, actor.organizationId));
    const byFacility = new Map(rows.map((r) => [r.facilityId, r]));
    return facilities.map((f) => {
      const row = byFacility.get(f.id);
      return {
        facilityId: f.id,
        facilityName: f.name,
        customized: Boolean(row),
        rules: row ? toRules(row) : DEFAULT_BOOKING_RULES,
        version: row?.version ?? null,
        updatedAt: row?.updatedAt.toISOString() ?? null,
      };
    });
  }

  /** Sets a facility's rules (all of them at once; `version` is null while the facility still uses the defaults). */
  async update(actor: Actor, facilityId: string, input: z.infer<typeof updateBookingRulesSchema>): Promise<FacilityBookingRules> {
    const facility = (await this.organizations.listFacilities(actor.organizationId)).find((f) => f.id === facilityId);
    if (!facility) throw new NotFoundError("Facility");
    const { version, ...rules } = input;
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(facilityBookingRule)
        .where(and(eq(facilityBookingRule.organizationId, actor.organizationId), eq(facilityBookingRule.facilityId, facilityId)))
        .for("update");
      // Changing rules that exist needs the version that was read; the first setting has nothing to conflict with.
      if (current) assertVersion(current.version, version ?? -1, "Booking rules");
      const before = current ? toRules(current) : DEFAULT_BOOKING_RULES;
      const [saved] = current
        ? await tx
            .update(facilityBookingRule)
            .set({ ...rules, updatedAt: new Date(), updatedBy: actor.userId, version: sql`${facilityBookingRule.version} + 1` })
            .where(eq(facilityBookingRule.facilityId, facilityId))
            .returning()
        : await tx
            .insert(facilityBookingRule)
            .values({ ...rules, facilityId, organizationId: actor.organizationId, updatedBy: actor.userId })
            .returning();
      await this.audit.record(tx, actor, {
        action: "facility.booking-rules-update",
        resourceType: "facility_booking_rule",
        resourceId: facilityId,
        changes: diffChanges(before, rules, FIELDS),
        metadata: { firstTime: !current },
      });
      return {
        facilityId,
        facilityName: facility.name,
        customized: true,
        rules: toRules(saved!),
        version: saved!.version,
        updatedAt: saved!.updatedAt.toISOString(),
      };
    });
  }
}
