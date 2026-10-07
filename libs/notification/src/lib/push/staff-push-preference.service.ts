import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database } from "@healthcare/core";
import { and, eq } from "drizzle-orm";
import { STAFF_PUSH_KINDS, type StaffPushKind, staffPushPreference } from "../notification.schema";
import { STAFF_PUSH_KIND_LABEL } from "../templates";

export interface StaffPushPreferenceView {
  kind: StaffPushKind;
  label: string;
  enabled: boolean;
}

/**
 * Which kinds of in-app notice a staff member also receives as a push in their browsers (migration 0106). Every kind
 * is on until the member turns it off; a kind turned off skips the push row (the in-app notice is unaffected and
 * nothing is recorded as suppressed). The test push ignores preferences.
 */
@Injectable()
export class StaffPushPreferenceService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Every kind with whether it is on, in the screen's order. */
  async list(organizationId: string, userId: string): Promise<StaffPushPreferenceView[]> {
    const rows = await this.db
      .select({ kind: staffPushPreference.kind, enabled: staffPushPreference.enabled })
      .from(staffPushPreference)
      .where(and(eq(staffPushPreference.organizationId, organizationId), eq(staffPushPreference.userId, userId)));
    const off = new Set(rows.filter((r) => !r.enabled).map((r) => r.kind));
    return STAFF_PUSH_KINDS.map((kind) => ({ kind, label: STAFF_PUSH_KIND_LABEL[kind], enabled: !off.has(kind) }));
  }

  /** Whether a kind is on for the member (true when never set). */
  async isEnabled(organizationId: string, userId: string, kind: StaffPushKind): Promise<boolean> {
    const [row] = await this.db
      .select({ enabled: staffPushPreference.enabled })
      .from(staffPushPreference)
      .where(and(eq(staffPushPreference.organizationId, organizationId), eq(staffPushPreference.userId, userId), eq(staffPushPreference.kind, kind)));
    return row?.enabled ?? true;
  }

  /** Replaces the member's choices: every kind named is set as given, the others are left as they are. */
  async set(organizationId: string, userId: string, preferences: ReadonlyArray<{ kind: StaffPushKind; enabled: boolean }>): Promise<StaffPushPreferenceView[]> {
    await this.db.transaction(async (tx) => {
      for (const { kind, enabled } of preferences) {
        await tx
          .insert(staffPushPreference)
          .values({ organizationId, userId, kind, enabled })
          .onConflictDoUpdate({
            target: [staffPushPreference.organizationId, staffPushPreference.userId, staffPushPreference.kind],
            set: { enabled, updatedAt: new Date() },
          });
      }
    });
    return this.list(organizationId, userId);
  }
}
