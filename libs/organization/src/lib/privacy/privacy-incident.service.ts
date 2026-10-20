import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  type Actor,
  BusinessRuleError,
  DATABASE,
  type Database,
  type DbExecutor,
  DomainEventPublisher,
  NotFoundError,
  VersionConflictError,
} from "@healthcare/core";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import type {
  addIncidentEntrySchema,
  assessIncidentSchema,
  closeIncidentSchema,
  privacySettingSchema,
  recordNpcNotificationSchema,
  recordPrivacyIncidentSchema,
  recordSubjectsNotificationSchema,
} from "./privacy.dto";
import { canClose, DEFAULT_BREACH_NOTIFICATION_HOURS, hoursLeft, notificationOverdue, notificationPending, notifyBy } from "./privacy.rules";
import {
  privacyIncident,
  privacyIncidentEntry,
  type PrivacyIncidentEntryRecord,
  privacyIncidentNumberSequence,
  type PrivacyIncidentRecord,
  privacySetting,
} from "./privacy.schema";

export type PrivacyIncidentView = Omit<PrivacyIncidentRecord, "organizationId"> & {
  /** Whether a notification is still expected, whether its window has passed, and the hours left (negative once passed). */
  notificationPending: boolean;
  notificationOverdue: boolean;
  hoursLeft: number | null;
};

export type PrivacyIncidentEntryView = Omit<PrivacyIncidentEntryRecord, "organizationId" | "incidentId">;

export interface PrivacySettingView {
  breachNotificationHours: number;
  dpoName: string | null;
  dpoContact: string | null;
  version: number;
  updatedAt: Date | null;
}

/**
 * The personal data breach register (docs/security/data-privacy-act.md; migration 0114): every incident the
 * organization discovers, its assessment (notifiable or not, with the reason), the notifications it made to the
 * National Privacy Commission and to the affected people as it recorded them, and its closure; each step is an
 * append-only entry and an audit event. The notification window is the organization's own setting — the platform
 * counts the hours and flags the window as passed; it decides nothing and notifies no one.
 */
@Injectable()
export class PrivacyIncidentService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
  ) {}

  // ---- settings ----------------------------------------------------------------------------------------------

  async setting(organizationId: string, executor: DbExecutor = this.db): Promise<PrivacySettingView> {
    const [row] = await executor.select().from(privacySetting).where(eq(privacySetting.organizationId, organizationId));
    if (!row) return { breachNotificationHours: DEFAULT_BREACH_NOTIFICATION_HOURS, dpoName: null, dpoContact: null, version: 0, updatedAt: null };
    return {
      breachNotificationHours: row.breachNotificationHours,
      dpoName: row.dpoName,
      dpoContact: row.dpoContact,
      version: row.version,
      updatedAt: row.updatedAt,
    };
  }

  async setSetting(actor: Actor, input: z.infer<typeof privacySettingSchema>): Promise<PrivacySettingView> {
    await this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(privacySetting).where(eq(privacySetting.organizationId, actor.organizationId)).for("update");
      if ((current?.version ?? 0) !== input.version) throw new VersionConflictError("Privacy setting", input.version);
      const values = {
        breachNotificationHours: input.breachNotificationHours,
        dpoName: input.dpoName,
        dpoContact: input.dpoContact,
        updatedBy: actor.userId,
        updatedAt: new Date(),
      };
      if (current) {
        await tx
          .update(privacySetting)
          .set({ ...values, version: current.version + 1 })
          .where(eq(privacySetting.organizationId, actor.organizationId));
      } else {
        await tx.insert(privacySetting).values({ organizationId: actor.organizationId, ...values });
      }
      await this.audit.record(tx, actor, {
        action: "privacy.setting.update",
        resourceType: "organization",
        resourceId: actor.organizationId,
        changes: {
          breachNotificationHours: { from: current?.breachNotificationHours ?? DEFAULT_BREACH_NOTIFICATION_HOURS, to: input.breachNotificationHours },
          dpoName: { from: current?.dpoName ?? null, to: input.dpoName },
          dpoContact: { from: current?.dpoContact ?? null, to: input.dpoContact },
        },
      });
    });
    return this.setting(actor.organizationId);
  }

  // ---- the register ------------------------------------------------------------------------------------------

  /** Open incidents first by discovery (newest first), or closed or all. Listing is audited: the register is sensitive. */
  async list(actor: Actor, status: "open" | "closed" | "all"): Promise<PrivacyIncidentView[]> {
    const filters = [eq(privacyIncident.organizationId, actor.organizationId)];
    if (status !== "all") filters.push(eq(privacyIncident.status, status));
    const rows = await this.db
      .select()
      .from(privacyIncident)
      .where(and(...filters))
      .orderBy(desc(privacyIncident.discoveredAt))
      .limit(200);
    await this.audit.recordStandalone(actor, { action: "privacy.incident.list", resourceType: "privacy_incident", metadata: { status, count: rows.length } });
    return rows.map(view);
  }

  /** Open incidents whose notification window is pending or passed (for the administration badge; not audited). */
  async countOpen(actor: Actor): Promise<{ open: number; overdue: number }> {
    const rows = await this.db
      .select({ assessment: privacyIncident.assessment, notifyBy: privacyIncident.notifyBy, npcNotifiedAt: privacyIncident.npcNotifiedAt })
      .from(privacyIncident)
      .where(and(eq(privacyIncident.organizationId, actor.organizationId), eq(privacyIncident.status, "open")));
    const now = new Date();
    return {
      open: rows.length,
      overdue: rows.filter((r) => notificationOverdue({ status: "open", ...r }, now)).length,
    };
  }

  async get(actor: Actor, incidentId: string): Promise<PrivacyIncidentView & { entries: PrivacyIncidentEntryView[] }> {
    const incident = await this.find(this.db, actor.organizationId, incidentId);
    const entries = await this.db
      .select()
      .from(privacyIncidentEntry)
      .where(and(eq(privacyIncidentEntry.organizationId, actor.organizationId), eq(privacyIncidentEntry.incidentId, incidentId)))
      .orderBy(asc(privacyIncidentEntry.recordedAt), asc(privacyIncidentEntry.id));
    await this.audit.recordStandalone(actor, { action: "privacy.incident.view", resourceType: "privacy_incident", resourceId: incidentId });
    return { ...view(incident), entries: entries.map(entryView) };
  }

  async record(actor: Actor, input: z.infer<typeof recordPrivacyIncidentSchema>): Promise<PrivacyIncidentView> {
    const discoveredAt = new Date(input.discoveredAt);
    if (discoveredAt.getTime() > Date.now() + 5 * 60_000) throw new BusinessRuleError("The discovery time is in the future", "discovered_in_future");
    const created = await this.db.transaction(async (tx) => {
      const setting = await this.setting(actor.organizationId, tx);
      const [counter] = await tx
        .insert(privacyIncidentNumberSequence)
        .values({ organizationId: actor.organizationId, nextValue: 1 })
        .onConflictDoUpdate({ target: privacyIncidentNumberSequence.organizationId, set: { nextValue: sql`${privacyIncidentNumberSequence.nextValue} + 1` } })
        .returning({ value: privacyIncidentNumberSequence.nextValue });
      if (!counter) throw new Error("Could not allocate an incident number");
      const [row] = await tx
        .insert(privacyIncident)
        .values({
          organizationId: actor.organizationId,
          incidentNumber: `PI${String(counter.value).padStart(8, "0")}`,
          title: input.title,
          description: input.description,
          discoveredAt,
          occurredAt: input.occurredAt ? new Date(input.occurredAt) : null,
          dataCategories: [...new Set(input.dataCategories)],
          affectedEstimate: input.affectedEstimate ?? null,
          notifyBy: notifyBy(discoveredAt, setting.breachNotificationHours),
          reportedBy: actor.userId,
        })
        .returning();
      const incident = found(row);
      await this.addEntry(tx, actor, incident, "reported", input.description);
      await this.audit.record(tx, actor, {
        action: "privacy.incident.record",
        resourceType: "privacy_incident",
        resourceId: incident.id,
        metadata: {
          incidentNumber: incident.incidentNumber,
          dataCategories: incident.dataCategories,
          affectedEstimate: incident.affectedEstimate,
          notifyBy: incident.notifyBy.toISOString(),
        },
      });
      await this.events.record(tx, incidentEvent("PrivacyIncidentRecorded", incident));
      return incident;
    });
    return view(created);
  }

  async addNote(actor: Actor, incidentId: string, input: z.infer<typeof addIncidentEntrySchema>): Promise<PrivacyIncidentView> {
    return this.change(actor, incidentId, input.version, "privacy.incident.note", async (tx, current) => {
      await this.addEntry(tx, actor, current, input.kind, input.note);
      return {};
    });
  }

  async assess(actor: Actor, incidentId: string, input: z.infer<typeof assessIncidentSchema>): Promise<PrivacyIncidentView> {
    return this.change(
      actor,
      incidentId,
      input.version,
      "privacy.incident.assess",
      async (tx, current) => {
        await this.addEntry(tx, actor, current, "assessment", `${input.assessment === "notifiable" ? "Notifiable" : "Not notifiable"}: ${input.reason}`);
        return { assessment: input.assessment, assessmentReason: input.reason, assessedAt: new Date(), assessedBy: actor.userId };
      },
      { assessment: input.assessment },
      input.reason,
    );
  }

  async recordNpcNotification(actor: Actor, incidentId: string, input: z.infer<typeof recordNpcNotificationSchema>): Promise<PrivacyIncidentView> {
    return this.change(
      actor,
      incidentId,
      input.version,
      "privacy.incident.npc-notified",
      async (tx, current) => {
        if (current.npcNotifiedAt) throw new BusinessRuleError("The NPC notification is already recorded", "already_recorded");
        const notifiedAt = new Date(input.notifiedAt);
        if (notifiedAt < current.discoveredAt) throw new BusinessRuleError("The notification cannot precede the discovery", "before_discovery");
        await this.addEntry(tx, actor, current, "npc_notified", [`NPC notified (${input.reference})`, input.note].filter(Boolean).join(": "));
        return { npcNotifiedAt: notifiedAt, npcReference: input.reference };
      },
      { reference: input.reference, notifiedAt: input.notifiedAt },
    );
  }

  async recordSubjectsNotification(actor: Actor, incidentId: string, input: z.infer<typeof recordSubjectsNotificationSchema>): Promise<PrivacyIncidentView> {
    return this.change(
      actor,
      incidentId,
      input.version,
      "privacy.incident.subjects-notified",
      async (tx, current) => {
        if (current.subjectsNotifiedAt) throw new BusinessRuleError("The notification of the affected people is already recorded", "already_recorded");
        const notifiedAt = new Date(input.notifiedAt);
        if (notifiedAt < current.discoveredAt) throw new BusinessRuleError("The notification cannot precede the discovery", "before_discovery");
        await this.addEntry(tx, actor, current, "subjects_notified", [`Affected people told: ${input.method}`, input.note].filter(Boolean).join(". "));
        return { subjectsNotifiedAt: notifiedAt, subjectsNotificationMethod: input.method };
      },
      { method: input.method, notifiedAt: input.notifiedAt },
    );
  }

  async close(actor: Actor, incidentId: string, input: z.infer<typeof closeIncidentSchema>): Promise<PrivacyIncidentView> {
    return this.change(
      actor,
      incidentId,
      input.version,
      "privacy.incident.close",
      async (tx, current) => {
        if (!canClose(current)) throw new BusinessRuleError("Assess the incident (notifiable or not) before closing it", "assessment_required");
        await this.addEntry(tx, actor, current, "closed", input.note);
        return { status: "closed" as const, closedAt: new Date(), closedBy: actor.userId, closureNote: input.note };
      },
      {},
      input.note,
      "PrivacyIncidentClosed",
    );
  }

  // ---- internals ---------------------------------------------------------------------------------------------

  private async change(
    actor: Actor,
    incidentId: string,
    version: number,
    action: string,
    apply: (tx: DbExecutor, current: PrivacyIncidentRecord) => Promise<Partial<PrivacyIncidentRecord>>,
    metadata: Record<string, unknown> = {},
    reason?: string,
    event?: string,
  ): Promise<PrivacyIncidentView> {
    const updated = await this.db.transaction(async (tx) => {
      const current = await this.find(tx, actor.organizationId, incidentId, true);
      if (current.version !== version) throw new VersionConflictError("Privacy incident", version);
      if (current.status === "closed") throw new BusinessRuleError("This incident is closed", "incident_closed");
      const changes = await apply(tx, current);
      const [row] = await tx
        .update(privacyIncident)
        .set({ ...changes, updatedAt: new Date(), version: sql`${privacyIncident.version} + 1` })
        .where(eq(privacyIncident.id, incidentId))
        .returning();
      const incident = found(row);
      await this.audit.record(tx, actor, {
        action,
        resourceType: "privacy_incident",
        resourceId: incidentId,
        reason,
        metadata: { incidentNumber: incident.incidentNumber, status: incident.status, ...metadata },
      });
      if (event) await this.events.record(tx, incidentEvent(event, incident));
      return incident;
    });
    return view(updated);
  }

  private async addEntry(tx: DbExecutor, actor: Actor, incident: PrivacyIncidentRecord, kind: PrivacyIncidentEntryRecord["kind"], note: string) {
    await tx.insert(privacyIncidentEntry).values({ organizationId: incident.organizationId, incidentId: incident.id, kind, note, recordedBy: actor.userId });
  }

  private async find(executor: DbExecutor, organizationId: string, incidentId: string, forUpdate = false): Promise<PrivacyIncidentRecord> {
    const query = executor
      .select()
      .from(privacyIncident)
      .where(and(eq(privacyIncident.organizationId, organizationId), eq(privacyIncident.id, incidentId)));
    const [row] = forUpdate ? await query.for("update") : await query;
    return found(row);
  }
}

function found(row: PrivacyIncidentRecord | undefined): PrivacyIncidentRecord {
  if (!row) throw new NotFoundError("Privacy incident");
  return row;
}

function view(row: PrivacyIncidentRecord): PrivacyIncidentView {
  const { organizationId: _o, ...rest } = row;
  const now = new Date();
  return { ...rest, notificationPending: notificationPending(row), notificationOverdue: notificationOverdue(row, now), hoursLeft: hoursLeft(row, now) };
}

function entryView(row: PrivacyIncidentEntryRecord): PrivacyIncidentEntryView {
  const { organizationId: _o, incidentId: _i, ...rest } = row;
  return rest;
}

/** Ids and status only — never the description. */
function incidentEvent(type: string, row: PrivacyIncidentRecord) {
  return {
    type,
    organizationId: row.organizationId,
    aggregateType: "privacy_incident",
    aggregateId: row.id,
    payload: { incidentNumber: row.incidentNumber, status: row.status, assessment: row.assessment },
  };
}
