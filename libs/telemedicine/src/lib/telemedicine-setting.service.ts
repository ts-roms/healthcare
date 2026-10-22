import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { type Actor, DATABASE, type Database, type DbExecutor, VersionConflictError } from "@healthcare/core";
import { eq } from "drizzle-orm";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { telemedicineSetting } from "./telemedicine.schema";

export const telemedicineSettingSchema = z.object({
  /** An online visit must be paid for (its invoice settled) before the patient may enter the waiting room. */
  paymentRequired: z.boolean(),
  /** The version read; 0 when nothing was saved yet. */
  version: z.number().int().min(0),
});
export class TelemedicineSettingDto extends createZodDto(telemedicineSettingSchema) {}

export interface TelemedicineSettingView {
  paymentRequired: boolean;
  version: number;
  updatedAt: Date | null;
}

/** The organization's telemedicine policy (migration 0125). Payment is not required unless an administrator turns it on. */
@Injectable()
export class TelemedicineSettingService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async get(organizationId: string, executor: DbExecutor = this.db): Promise<TelemedicineSettingView> {
    const [row] = await executor.select().from(telemedicineSetting).where(eq(telemedicineSetting.organizationId, organizationId));
    return row
      ? { paymentRequired: row.paymentRequired, version: row.version, updatedAt: row.updatedAt }
      : { paymentRequired: false, version: 0, updatedAt: null };
  }

  async set(actor: Actor, input: z.infer<typeof telemedicineSettingSchema>): Promise<TelemedicineSettingView> {
    await this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(telemedicineSetting).where(eq(telemedicineSetting.organizationId, actor.organizationId)).for("update");
      if ((current?.version ?? 0) !== input.version) throw new VersionConflictError("Telemedicine setting", input.version);
      const values = { paymentRequired: input.paymentRequired, updatedBy: actor.userId, updatedAt: new Date() };
      if (current) {
        await tx
          .update(telemedicineSetting)
          .set({ ...values, version: current.version + 1 })
          .where(eq(telemedicineSetting.organizationId, actor.organizationId));
      } else {
        await tx.insert(telemedicineSetting).values({ organizationId: actor.organizationId, ...values });
      }
      await this.audit.record(tx, actor, {
        action: "telemedicine.setting.update",
        resourceType: "organization",
        resourceId: actor.organizationId,
        changes: { paymentRequired: { from: current?.paymentRequired ?? false, to: input.paymentRequired } },
      });
    });
    return this.get(actor.organizationId);
  }
}
