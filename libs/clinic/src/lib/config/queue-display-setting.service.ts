import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { type Actor, DATABASE, type Database } from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import type { updateQueueDisplaySettingsSchema } from "../clinic.dto";
import { queueDisplaySetting } from "../clinic.schema";
import { assertVersion, found } from "../clinic-support";

/** What the waiting-room display says in the clinic's own words; `version` is null while the facility uses the defaults. */
export interface QueueDisplaySettingsView {
  facilityId: string;
  headline: string | null;
  footerMessage: string | null;
  accentColor: string | null;
  groupByServicePoint: boolean;
  version: number | null;
}

const DEFAULTS = (facilityId: string): QueueDisplaySettingsView => ({
  facilityId,
  headline: null,
  footerMessage: null,
  accentColor: null,
  groupByServicePoint: false,
  version: null,
});

/**
 * The waiting-room display's own settings per facility (docs/domains/kiosk.md, migration 0139): a headline and a footer
 * line in the clinic's words, an accent colour, and whether the screen groups calls by service point. Nothing here is
 * about a patient.
 */
@Injectable()
export class QueueDisplaySettingService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly organizations: OrganizationService,
  ) {}

  /** The settings the display itself reads (the caller already checked the facility). */
  async forFacility(organizationId: string, facilityId: string): Promise<QueueDisplaySettingsView> {
    const [row] = await this.db
      .select()
      .from(queueDisplaySetting)
      .where(and(eq(queueDisplaySetting.organizationId, organizationId), eq(queueDisplaySetting.facilityId, facilityId)));
    return row ? this.toView(row) : DEFAULTS(facilityId);
  }

  async get(actor: Actor, facilityId: string): Promise<QueueDisplaySettingsView> {
    await this.organizations.getFacility(actor.organizationId, facilityId);
    return this.forFacility(actor.organizationId, facilityId);
  }

  /** Sets a facility's display settings; an omitted text keeps the current one, an empty or null one clears it. Audited. */
  async update(actor: Actor, input: z.infer<typeof updateQueueDisplaySettingsSchema>): Promise<QueueDisplaySettingsView> {
    await this.organizations.getFacility(actor.organizationId, input.facilityId);
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(queueDisplaySetting)
        .where(and(eq(queueDisplaySetting.organizationId, actor.organizationId), eq(queueDisplaySetting.facilityId, input.facilityId)))
        .for("update");
      if (current) assertVersion(current.version, input.version ?? current.version, "Display settings");
      const headline = input.headline === undefined ? (current?.headline ?? null) : input.headline;
      const footerMessage = input.footerMessage === undefined ? (current?.footerMessage ?? null) : input.footerMessage;
      const accentColor = input.accentColor === undefined ? (current?.accentColor ?? null) : input.accentColor;
      const [row] = await tx
        .insert(queueDisplaySetting)
        .values({
          organizationId: actor.organizationId,
          facilityId: input.facilityId,
          headline,
          footerMessage,
          accentColor,
          groupByServicePoint: input.groupByServicePoint,
          updatedBy: actor.userId,
        })
        .onConflictDoUpdate({
          target: [queueDisplaySetting.organizationId, queueDisplaySetting.facilityId],
          set: {
            headline,
            footerMessage,
            accentColor,
            groupByServicePoint: input.groupByServicePoint,
            updatedBy: actor.userId,
            updatedAt: new Date(),
            version: sql`${queueDisplaySetting.version} + 1`,
          },
        })
        .returning();
      const saved = found(row, "Display settings");
      await this.audit.record(tx, actor, {
        action: "queue-display-setting.update",
        resourceType: "queue_display_setting",
        resourceId: saved.id,
        changes: {
          headline: { from: current?.headline ?? null, to: saved.headline },
          footerMessage: { from: current?.footerMessage ?? null, to: saved.footerMessage },
          accentColor: { from: current?.accentColor ?? null, to: saved.accentColor },
          groupByServicePoint: { from: current?.groupByServicePoint ?? false, to: saved.groupByServicePoint },
        },
        metadata: { facilityId: input.facilityId },
      });
      return this.toView(saved);
    });
  }

  private toView(row: typeof queueDisplaySetting.$inferSelect): QueueDisplaySettingsView {
    return {
      facilityId: row.facilityId,
      headline: row.headline,
      footerMessage: row.footerMessage,
      accentColor: row.accentColor,
      groupByServicePoint: row.groupByServicePoint,
      version: row.version,
    };
  }
}
