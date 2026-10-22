import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { type Actor, DATABASE, type Database, type DbExecutor, VersionConflictError } from "@healthcare/core";
import { eq } from "drizzle-orm";
import type { z } from "zod";
import type { staffTourSettingSchema } from "./tour.dto";
import { staffTourSetting } from "./tour.schema";

export interface StaffTourSettingView {
  enabled: boolean;
  version: number;
  updatedAt: Date | null;
}

/** Whether the organization offers the staff app's guided tour (migration 0124). On unless an administrator switched it off. */
@Injectable()
export class StaffTourSettingService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async get(organizationId: string, executor: DbExecutor = this.db): Promise<StaffTourSettingView> {
    const [row] = await executor.select().from(staffTourSetting).where(eq(staffTourSetting.organizationId, organizationId));
    return row ? { enabled: row.enabled, version: row.version, updatedAt: row.updatedAt } : { enabled: true, version: 0, updatedAt: null };
  }

  async set(actor: Actor, input: z.infer<typeof staffTourSettingSchema>): Promise<StaffTourSettingView> {
    await this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(staffTourSetting).where(eq(staffTourSetting.organizationId, actor.organizationId)).for("update");
      if ((current?.version ?? 0) !== input.version) throw new VersionConflictError("Guided tour setting", input.version);
      const values = { enabled: input.enabled, updatedBy: actor.userId, updatedAt: new Date() };
      if (current) {
        await tx
          .update(staffTourSetting)
          .set({ ...values, version: current.version + 1 })
          .where(eq(staffTourSetting.organizationId, actor.organizationId));
      } else {
        await tx.insert(staffTourSetting).values({ organizationId: actor.organizationId, ...values });
      }
      await this.audit.record(tx, actor, {
        action: "tour.setting.update",
        resourceType: "organization",
        resourceId: actor.organizationId,
        changes: { enabled: { from: current?.enabled ?? true, to: input.enabled } },
      });
    });
    return this.get(actor.organizationId);
  }
}
