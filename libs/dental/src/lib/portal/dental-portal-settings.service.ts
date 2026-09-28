import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { type Actor, DATABASE, type Database, type DbExecutor, VersionConflictError } from "@healthcare/core";
import { eq } from "drizzle-orm";
import { dentalOrganizationSetting } from "../dental.schema";
import { assertVersion } from "../dental-support";
import { DENTAL_CONTEXT, type DentalContext } from "../ports";

export interface DentalPortalSettingView {
  /** Patients see their dental records in MyHealth (off by default). */
  portalDentalRecords: boolean;
  /** 0 until the organization first sets it. */
  version: number;
  updatedAt: Date | null;
  updatedByName: string | null;
}

/**
 * The organization's choice to show patients their dental records in MyHealth. Off by default: releasing dental
 * records to patients is a decision each organization makes (docs/domains/dental.md). What patients then see is fixed
 * in code (`DentalPatientAccess`), not configurable here.
 */
@Injectable()
export class DentalPortalSettings {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    @Inject(DENTAL_CONTEXT) private readonly context: DentalContext,
  ) {}

  async enabled(organizationId: string, executor: DbExecutor = this.db): Promise<boolean> {
    return (await this.row(executor, organizationId))?.portalDentalRecords ?? false;
  }

  async get(organizationId: string): Promise<DentalPortalSettingView> {
    const row = await this.row(this.db, organizationId);
    if (!row) return { portalDentalRecords: false, version: 0, updatedAt: null, updatedByName: null };
    const names = await this.context.staffNames(organizationId, [row.updatedBy]);
    return { portalDentalRecords: row.portalDentalRecords, version: row.version, updatedAt: row.updatedAt, updatedByName: names.get(row.updatedBy) ?? null };
  }

  /** Turns MyHealth dental records on or off (optimistic `version`; audited with before and after). */
  async set(actor: Actor, portalDentalRecords: boolean, version: number): Promise<DentalPortalSettingView> {
    await this.db.transaction(async (tx) => {
      const current = await this.row(tx, actor.organizationId, true);
      const from = current?.portalDentalRecords ?? false;
      if (current) {
        assertVersion(current.version, version, "Dental portal setting");
        await tx
          .update(dentalOrganizationSetting)
          .set({ portalDentalRecords, version: current.version + 1, updatedBy: actor.userId, updatedAt: new Date() })
          .where(eq(dentalOrganizationSetting.organizationId, actor.organizationId));
      } else {
        assertVersion(0, version, "Dental portal setting");
        const [created] = await tx
          .insert(dentalOrganizationSetting)
          .values({ organizationId: actor.organizationId, portalDentalRecords, updatedBy: actor.userId })
          .onConflictDoNothing()
          .returning();
        // Someone else set it first.
        if (!created) throw new VersionConflictError("Dental portal setting", version);
      }
      await this.audit.record(tx, actor, {
        action: "dental.settings.portal",
        resourceType: "organization",
        resourceId: actor.organizationId,
        changes: { portalDentalRecords: { from, to: portalDentalRecords } },
      });
    });
    return this.get(actor.organizationId);
  }

  private async row(executor: DbExecutor, organizationId: string, lock = false) {
    const query = executor.select().from(dentalOrganizationSetting).where(eq(dentalOrganizationSetting.organizationId, organizationId));
    const [row] = lock ? await query.for("update") : await query;
    return row;
  }
}
