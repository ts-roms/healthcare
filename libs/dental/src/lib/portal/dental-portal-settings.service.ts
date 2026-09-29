import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { type Actor, BusinessRuleError, DATABASE, type Database, type DbExecutor, VersionConflictError } from "@healthcare/core";
import { eq } from "drizzle-orm";
import { dentalOrganizationSetting } from "../dental.schema";
import { assertVersion } from "../dental-support";
import { DENTAL_CONTEXT, type DentalContext } from "../ports";

export interface DentalPortalSettingView {
  /** Patients see their dental records in MyHealth (off by default). */
  portalDentalRecords: boolean;
  /** Patients accept or decline treatment plan items in MyHealth (off by default; needs dental records shared). */
  portalPlanDecisions: boolean;
  /** The organization's own text the patient confirms before deciding online (the platform supplies none). */
  portalPlanAcknowledgement: string | null;
  /** 0 until the organization first sets it. */
  version: number;
  updatedAt: Date | null;
  updatedByName: string | null;
}

export interface DentalPortalSettingInput {
  portalDentalRecords: boolean;
  /** Left out: unchanged. Turned off whenever dental records are not shared. */
  portalPlanDecisions?: boolean;
  /** Left out: unchanged. Required (20–1000 characters) for plan decisions. */
  portalPlanAcknowledgement?: string | null;
  version: number;
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

  /** Whether patients may decide plans online, and the acknowledgement they confirm; undefined when not allowed. */
  async decisions(organizationId: string, executor: DbExecutor = this.db): Promise<{ acknowledgement: string } | undefined> {
    const row = await this.row(executor, organizationId);
    return row?.portalDentalRecords && row.portalPlanDecisions && row.portalPlanAcknowledgement
      ? { acknowledgement: row.portalPlanAcknowledgement }
      : undefined;
  }

  async get(organizationId: string): Promise<DentalPortalSettingView> {
    const row = await this.row(this.db, organizationId);
    if (!row)
      return { portalDentalRecords: false, portalPlanDecisions: false, portalPlanAcknowledgement: null, version: 0, updatedAt: null, updatedByName: null };
    const names = await this.context.staffNames(organizationId, [row.updatedBy]);
    return {
      portalDentalRecords: row.portalDentalRecords,
      portalPlanDecisions: row.portalPlanDecisions,
      portalPlanAcknowledgement: row.portalPlanAcknowledgement,
      version: row.version,
      updatedAt: row.updatedAt,
      updatedByName: names.get(row.updatedBy) ?? null,
    };
  }

  /**
   * Turns MyHealth dental records (and online plan decisions, with the organization's acknowledgement text) on or off
   * (optimistic `version`; audited with before and after).
   */
  async set(actor: Actor, input: DentalPortalSettingInput): Promise<DentalPortalSettingView> {
    await this.db.transaction(async (tx) => {
      const current = await this.row(tx, actor.organizationId, true);
      assertVersion(current?.version ?? 0, input.version, "Dental portal setting");
      const acknowledgement =
        input.portalPlanAcknowledgement === undefined ? (current?.portalPlanAcknowledgement ?? null) : input.portalPlanAcknowledgement?.trim() || null;
      const decisions = input.portalDentalRecords && (input.portalPlanDecisions ?? current?.portalPlanDecisions ?? false);
      if (decisions && !acknowledgement) {
        throw new BusinessRuleError("Write the acknowledgement patients confirm before deciding a plan online", "acknowledgement_required");
      }
      const values = {
        portalDentalRecords: input.portalDentalRecords,
        portalPlanDecisions: decisions,
        portalPlanAcknowledgement: acknowledgement,
        updatedBy: actor.userId,
        updatedAt: new Date(),
      };
      if (current) {
        await tx
          .update(dentalOrganizationSetting)
          .set({ ...values, version: current.version + 1 })
          .where(eq(dentalOrganizationSetting.organizationId, actor.organizationId));
      } else {
        const [created] = await tx
          .insert(dentalOrganizationSetting)
          .values({ organizationId: actor.organizationId, ...values })
          .onConflictDoNothing()
          .returning();
        // Someone else set it first.
        if (!created) throw new VersionConflictError("Dental portal setting", input.version);
      }
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      const before = {
        portalDentalRecords: current?.portalDentalRecords ?? false,
        portalPlanDecisions: current?.portalPlanDecisions ?? false,
        portalPlanAcknowledgement: current?.portalPlanAcknowledgement ?? null,
      };
      for (const key of Object.keys(before) as Array<keyof typeof before>) {
        if (before[key] !== values[key]) changes[key] = { from: before[key], to: values[key] };
      }
      await this.audit.record(tx, actor, {
        action: "dental.settings.portal",
        resourceType: "organization",
        resourceId: actor.organizationId,
        changes,
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
