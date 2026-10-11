import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { BusinessRuleError, DATABASE, type Database } from "@healthcare/core";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { COMMUNICATION_CATEGORIES, patient, patientCommunicationPreference, patientContactPoint } from "../patient.schema";
import { patientAuditContext, type PortalPrincipal } from "../portal/portal-account.service";
import { PushDeviceCounts } from "./push-device-counts";
import {
  defaultOptedIn,
  describePushDevices,
  maskDestination,
  PORTAL_PREFERENCE_CATEGORIES,
  PORTAL_PREFERENCE_CHANNELS,
  type PortalPreferenceChannel,
} from "./portal-preferences.rules";
import type { PortalPreferencesView, PortalPreferenceView } from "./portal-preferences.views";

export const portalPreferencesSchema = z.object({
  preferences: z
    .array(z.object({ channel: z.enum(PORTAL_PREFERENCE_CHANNELS), category: z.enum(COMMUNICATION_CATEGORIES), optedIn: z.boolean() }))
    .min(1)
    .max(PORTAL_PREFERENCE_CHANNELS.length * PORTAL_PREFERENCE_CATEGORIES.length)
    .refine((list) => new Set(list.map((p) => `${p.channel}.${p.category}`)).size === list.length, "Each choice may be given once"),
});
export type PortalPreferencesInput = z.infer<typeof portalPreferencesSchema>;

/**
 * The patient's own notification settings in MyHealth (docs/architecture/portal-app.md, "Notification settings").
 * The patient sets text messages and email per kind of message; the same rows the notification service already consults
 * (resolvePatientContact), so a choice applies to the next message. Changes are audited with actor type "patient".
 */
@Injectable()
export class PortalPreferencesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly pushDevices: PushDeviceCounts,
  ) {}

  async get(principal: PortalPrincipal): Promise<PortalPreferencesView> {
    const view = await this.read(this.db, principal);
    await this.audit.recordStandalone(patientAuditContext(principal), {
      action: "portal.communication-preferences-view",
      resourceType: "patient_communication_preference",
      patientId: principal.patientId,
    });
    return view;
  }

  async set(principal: PortalPrincipal, input: PortalPreferencesInput): Promise<PortalPreferencesView> {
    return this.db.transaction(async (tx) => {
      const [record] = await tx
        .select({ status: patient.status })
        .from(patient)
        .where(and(eq(patient.organizationId, principal.organizationId), eq(patient.id, principal.patientId)));
      if (!record || record.status === "merged" || record.status === "deceased") {
        throw new BusinessRuleError("These settings cannot be changed on this record", "preferences_not_editable");
      }
      const before = await tx.select().from(patientCommunicationPreference).where(eq(patientCommunicationPreference.patientId, principal.patientId));
      const now = new Date();
      for (const pref of input.preferences) {
        await tx
          .insert(patientCommunicationPreference)
          .values({
            organizationId: principal.organizationId,
            patientId: principal.patientId,
            ...pref,
            updatedAt: now,
            updatedBy: null,
            updatedByPortalAccount: principal.accountId,
          })
          .onConflictDoUpdate({
            target: [patientCommunicationPreference.patientId, patientCommunicationPreference.channel, patientCommunicationPreference.category],
            set: { optedIn: pref.optedIn, updatedAt: now, updatedBy: null, updatedByPortalAccount: principal.accountId },
          });
      }
      const changes = Object.fromEntries(
        input.preferences.map((p) => {
          const previous = before.find((b) => b.channel === p.channel && b.category === p.category);
          return [`${p.channel}.${p.category}`, { from: previous?.optedIn ?? null, to: p.optedIn }];
        }),
      );
      await this.audit.record(tx, patientAuditContext(principal), {
        action: "portal.communication-preferences",
        resourceType: "patient_communication_preference",
        resourceId: principal.patientId,
        patientId: principal.patientId,
        changes,
      });
      return this.read(tx, principal);
    });
  }

  private async read(db: Pick<Database, "select">, principal: PortalPrincipal): Promise<PortalPreferencesView> {
    // One after the other: `db` may be the caller's transaction, a single connection.
    const rows = await db
      .select()
      .from(patientCommunicationPreference)
      .where(
        and(eq(patientCommunicationPreference.organizationId, principal.organizationId), eq(patientCommunicationPreference.patientId, principal.patientId)),
      );
    const contacts = await db
      .select({ system: patientContactPoint.system, value: patientContactPoint.valueNormalized })
      .from(patientContactPoint)
      .where(
        and(
          eq(patientContactPoint.organizationId, principal.organizationId),
          eq(patientContactPoint.patientId, principal.patientId),
          eq(patientContactPoint.isPrimary, true),
          eq(patientContactPoint.status, "active"),
        ),
      );
    const destinations = {} as Record<PortalPreferenceChannel, string | null>;
    for (const channel of PORTAL_PREFERENCE_CHANNELS) {
      destinations[channel] =
        channel === "push"
          ? describePushDevices(await this.pushDevices.count(principal.accountId))
          : maskDestination(channel, contacts.find((c) => c.system === (channel === "sms" ? "mobile" : "email"))?.value);
    }
    const preferences: PortalPreferenceView[] = [];
    for (const channel of PORTAL_PREFERENCE_CHANNELS) {
      for (const category of PORTAL_PREFERENCE_CATEGORIES) {
        const row = rows.find((r) => r.channel === channel && r.category === category);
        preferences.push({
          channel,
          category,
          choice: row?.optedIn ?? null,
          enabled: row?.optedIn ?? defaultOptedIn(category),
          recordedVia: row ? (row.updatedByPortalAccount ? "myhealth" : "clinic") : null,
          updatedAt: row?.updatedAt.toISOString() ?? null,
        });
      }
    }
    return { destinations, preferences };
  }
}
