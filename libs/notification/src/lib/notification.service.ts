import { Inject, Injectable, Logger } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  type Actor,
  actorUserId,
  BusinessRuleError,
  DATABASE,
  type Database,
  filedAsPatient,
  maskEmail,
  maskPhone,
  localDayBounds,
  NotFoundError,
  type Page,
  PH_TIMEZONE,
  timelineInstant,
  timelineRange,
  type TimelineWindow,
} from "@healthcare/core";
import { and, count, desc, eq, gte, inArray, isNull, lt, type SQL, sql } from "drizzle-orm";
import type { z } from "zod";
import type { CommunicationLogQuery, sendNotificationSchema } from "./notification.dto";
import {
  NOTIFICATION_STATUSES,
  type NotificationCategory,
  type NotificationChannel,
  notification,
  type NotificationRecord,
  type NotificationStatus,
} from "./notification.schema";
import { NOTIFICATION_QUEUE, type NotificationQueue, RECIPIENT_DIRECTORY, type RecipientDirectory } from "./ports";
import { findTemplate, templateLabel, withoutSecrets } from "./templates";

export type SendNotificationInput = z.input<typeof sendNotificationSchema>;

export type NotificationView = Omit<NotificationRecord, "variables" | "destination"> & { destinationMasked: string | null; templateLabel: string };

export function toNotificationView({ variables: _v, destination, ...rest }: NotificationRecord): NotificationView {
  return { ...rest, destinationMasked: destination ? mask(destination) : null, templateLabel: templateLabel(rest.templateKey) };
}

/** One message to a patient in the communication log: what kind, how, and what became of it — never its content. */
export interface CommunicationLogEntry {
  id: string;
  patientId: string;
  channel: NotificationChannel;
  category: NotificationCategory;
  templateKey: string;
  templateLabel: string;
  status: NotificationStatus;
  /** Why it was not sent (consent, preferences, no contact detail…), for a suppressed message. */
  suppressionReason: string | null;
  destinationMasked: string | null;
  attemptCount: number;
  /** The staff member who asked for it; null when the platform sent it on its own (reminders, notices). */
  requestedBy: string | null;
  createdAt: Date;
  scheduledFor: Date | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  failedAt: Date | null;
  cancelledAt: Date | null;
  readAt: Date | null;
}

export interface CommunicationSummary {
  from: string;
  to: string;
  total: number;
  byStatus: Record<NotificationStatus, number>;
  byChannel: Array<{ channel: NotificationChannel; total: number; sent: number; notSent: number }>;
  /** Suppressed messages by reason, most frequent first. */
  suppressedByReason: Array<{ reason: string; total: number }>;
  /** Kinds of message, most frequent first. */
  byTemplate: Array<{ templateKey: string; templateLabel: string; total: number; notSent: number }>;
}

const NOT_SENT: NotificationStatus[] = ["failed", "suppressed", "cancelled"];
const REACHED: NotificationStatus[] = ["sent", "delivered"];

/** The UTC instants bounding local days `from`..`to` (inclusive) in the Philippines. */
function logWindow(from: string, to: string): { start: Date; end: Date } {
  return { start: localDayBounds(from, PH_TIMEZONE).start, end: localDayBounds(to, PH_TIMEZONE).end };
}

function mask(destination: string): string {
  return destination.includes("@") ? maskEmail(destination) : maskPhone(destination);
}

/**
 * The single entry point for outbound communication (CLAUDE.md §27).
 * Every request is stored — including ones suppressed by preferences — so the
 * communication history is complete; delivery happens in the worker.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(RECIPIENT_DIRECTORY) private readonly recipients: RecipientDirectory,
    @Inject(NOTIFICATION_QUEUE) private readonly queue: NotificationQueue,
    private readonly audit: AuditService,
  ) {}

  /**
   * `securityDestination` is for the platform's own internal security emails only (a code to an address being verified,
   * a notice to the address an account just left): it is honoured for internal security templates and ignored otherwise.
   * The public send endpoint never passes it.
   */
  async send(actor: Actor, input: SendNotificationInput, options: { securityDestination?: string } = {}): Promise<NotificationView> {
    const template = findTemplate(input.templateKey);
    if (!template) throw new BusinessRuleError(`Unknown template "${input.templateKey}"`, "unknown_template");
    if (!template.channels.includes(input.channel)) {
      throw new BusinessRuleError(`Template "${template.key}" cannot be sent via ${input.channel}`, "channel_not_supported");
    }
    const parsed = template.variables.safeParse(input.variables ?? {});
    if (!parsed.success) {
      throw new BusinessRuleError(
        "Template variables are invalid",
        "invalid_template_variables",
        parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      );
    }
    // Security messages reach a patient only through the platform's own internal templates (the directory decides where).
    if (input.recipient.type === "patient" && template.category === "security" && !template.internal) {
      throw new BusinessRuleError("Security templates are for staff accounts", "invalid_recipient");
    }

    if (input.idempotencyKey) {
      const [existing] = await this.db
        .select()
        .from(notification)
        .where(and(eq(notification.organizationId, actor.organizationId), eq(notification.idempotencyKey, input.idempotencyKey)));
      if (existing) return toNotificationView(existing);
    }

    const resolution =
      options.securityDestination && template.internal && template.category === "security" && input.channel === "email" && input.recipient.type === "patient"
        ? ({ allowed: true, destination: options.securityDestination } as const)
        : await this.recipients.resolve(actor.organizationId, input.recipient, input.channel, template.category);
    const inApp = input.channel === "in_app";
    const status = !resolution.allowed ? "suppressed" : inApp ? "delivered" : "queued";
    const scheduledFor = input.scheduledFor ? new Date(input.scheduledFor) : null;

    const created = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(notification)
        .values({
          organizationId: actor.organizationId,
          recipientType: input.recipient.type,
          recipientPatientId: input.recipient.type === "patient" ? input.recipient.patientId : null,
          recipientUserId: input.recipient.type === "user" ? input.recipient.userId : null,
          channel: input.channel,
          category: template.category,
          templateKey: template.key,
          templateVersion: template.version,
          destination: resolution.allowed ? resolution.destination : null,
          // A suppressed message is never sent: its credentials are not kept.
          variables: status === "suppressed" ? withoutSecrets(template, parsed.data as Record<string, unknown>) : (parsed.data as Record<string, unknown>),
          status,
          suppressionReason: resolution.allowed ? null : resolution.reason,
          idempotencyKey: input.idempotencyKey ?? null,
          scheduledFor,
          createdBy: actorUserId(actor),
          deliveredAt: status === "delivered" ? new Date() : null,
        })
        .onConflictDoNothing()
        .returning();
      if (!row) return undefined;
      await this.audit.record(tx, actor, {
        action: "notification.create",
        resourceType: "notification",
        resourceId: row.id,
        patientId: row.recipientPatientId ?? undefined,
        outcome: status === "suppressed" ? "denied" : "success",
        reason: row.suppressionReason ?? undefined,
        metadata: { channel: row.channel, templateKey: row.templateKey, category: row.category },
      });
      return row;
    });
    if (!created) {
      // Lost an idempotency race: return the winner.
      const [winner] = await this.db
        .select()
        .from(notification)
        .where(and(eq(notification.organizationId, actor.organizationId), eq(notification.idempotencyKey, input.idempotencyKey ?? "")));
      if (!winner) throw new Error("Notification insert conflicted but no existing row was found");
      return toNotificationView(winner);
    }

    if (created.status === "queued") {
      const delay = scheduledFor ? Math.max(scheduledFor.getTime() - Date.now(), 0) : 0;
      // The row is committed; if enqueueing fails the worker's reconciler picks it up.
      await this.queue.enqueue(created.id, delay).catch((error: unknown) => this.logger.warn(`Enqueue failed for ${created.id}: ${String(error)}`));
    }
    return toNotificationView(created);
  }

  /**
   * Cancels a not-yet-sent notification identified by its idempotency key
   * (e.g. the reminder of an appointment that was cancelled). No-op if it was
   * already sent or does not exist.
   */
  async cancelByIdempotencyKey(actor: Actor, idempotencyKey: string, reason: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [cancelled] = await tx
        .update(notification)
        .set({ status: "cancelled", cancelledAt: new Date(), lastError: reason, updatedAt: new Date() })
        .where(
          and(eq(notification.organizationId, actor.organizationId), eq(notification.idempotencyKey, idempotencyKey), inArray(notification.status, ["queued"])),
        )
        .returning();
      if (!cancelled) return false;
      await this.audit.record(tx, actor, {
        action: "notification.cancel",
        resourceType: "notification",
        resourceId: cancelled.id,
        patientId: cancelled.recipientPatientId ?? undefined,
        reason,
      });
      return true;
    });
  }

  /**
   * The communication log: messages to patients (never staff inbox messages) created in a period, newest first, with
   * their delivery status — never the message, its variables or the full destination. Includes records merged into a
   * patient when filtered by one. Not audited here: the caller (apps/api) audits the view.
   */
  async communicationLog(organizationId: string, query: CommunicationLogQuery): Promise<Page<CommunicationLogEntry>> {
    const { start, end } = logWindow(query.from, query.to);
    const filters: SQL[] = [
      eq(notification.organizationId, organizationId),
      eq(notification.recipientType, "patient"),
      gte(notification.createdAt, start),
      lt(notification.createdAt, end),
    ];
    if (query.channel) filters.push(eq(notification.channel, query.channel));
    if (query.category) filters.push(eq(notification.category, query.category));
    if (query.templateKey) filters.push(eq(notification.templateKey, query.templateKey));
    if (query.status === "not_sent") filters.push(inArray(notification.status, NOT_SENT));
    else if (query.status) filters.push(eq(notification.status, query.status));
    if (query.patientId) filters.push(filedAsPatient(notification.recipientPatientId, query.patientId));
    const rows = await this.db
      .select()
      .from(notification)
      .where(and(...filters))
      .orderBy(desc(notification.createdAt), desc(notification.id))
      .limit(query.pageSize + 1)
      .offset((query.page - 1) * query.pageSize);
    const hasMore = rows.length > query.pageSize;
    return {
      items: rows.slice(0, query.pageSize).map((r) => ({
        id: r.id,
        patientId: r.recipientPatientId!,
        channel: r.channel,
        category: r.category,
        templateKey: r.templateKey,
        templateLabel: templateLabel(r.templateKey),
        status: r.status,
        suppressionReason: r.status === "suppressed" ? r.suppressionReason : null,
        destinationMasked: r.destination ? mask(r.destination) : null,
        attemptCount: r.attemptCount,
        requestedBy: r.createdBy,
        createdAt: r.createdAt,
        scheduledFor: r.scheduledFor,
        sentAt: r.sentAt,
        deliveredAt: r.deliveredAt,
        failedAt: r.failedAt,
        cancelledAt: r.cancelledAt,
        readAt: r.readAt,
      })),
      page: query.page,
      pageSize: query.pageSize,
      hasMore,
    };
  }

  /** Counts of messages to patients in a period by status, channel, reason not sent and kind. Not audited here. */
  async communicationSummary(organizationId: string, from: string, to: string): Promise<CommunicationSummary> {
    const { start, end } = logWindow(from, to);
    const groups = await this.db
      .select({
        channel: notification.channel,
        status: notification.status,
        templateKey: notification.templateKey,
        reason: notification.suppressionReason,
        total: count(),
      })
      .from(notification)
      .where(
        and(
          eq(notification.organizationId, organizationId),
          eq(notification.recipientType, "patient"),
          gte(notification.createdAt, start),
          lt(notification.createdAt, end),
        ),
      )
      .groupBy(notification.channel, notification.status, notification.templateKey, notification.suppressionReason);
    const byStatus = Object.fromEntries(NOTIFICATION_STATUSES.map((k) => [k, 0])) as Record<NotificationStatus, number>;
    const channels = new Map<NotificationChannel, { channel: NotificationChannel; total: number; sent: number; notSent: number }>();
    const reasons = new Map<string, number>();
    const templates = new Map<string, { templateKey: string; templateLabel: string; total: number; notSent: number }>();
    let total = 0;
    for (const g of groups) {
      const n = Number(g.total);
      total += n;
      byStatus[g.status] += n;
      const c = channels.get(g.channel) ?? { channel: g.channel, total: 0, sent: 0, notSent: 0 };
      c.total += n;
      if (REACHED.includes(g.status)) c.sent += n;
      if (NOT_SENT.includes(g.status)) c.notSent += n;
      channels.set(g.channel, c);
      if (g.status === "suppressed") reasons.set(g.reason ?? "unknown", (reasons.get(g.reason ?? "unknown") ?? 0) + n);
      const t = templates.get(g.templateKey) ?? { templateKey: g.templateKey, templateLabel: templateLabel(g.templateKey), total: 0, notSent: 0 };
      t.total += n;
      if (NOT_SENT.includes(g.status)) t.notSent += n;
      templates.set(g.templateKey, t);
    }
    return {
      from,
      to,
      total,
      byStatus,
      byChannel: [...channels.values()].sort((a, b) => b.total - a.total),
      suppressedByReason: [...reasons].map(([reason, n]) => ({ reason, total: n })).sort((a, b) => b.total - a.total),
      byTemplate: [...templates.values()].sort((a, b) => b.total - a.total),
    };
  }

  async historyForPatient(actor: Actor, patientId: string): Promise<NotificationView[]> {
    const rows = await this.db
      .select()
      .from(notification)
      .where(and(eq(notification.organizationId, actor.organizationId), filedAsPatient(notification.recipientPatientId, patientId)))
      .orderBy(desc(notification.createdAt))
      .limit(200);
    await this.audit.recordStandalone(actor, { action: "notification.list", resourceType: "notification", patientId });
    return rows.map(toNotificationView);
  }

  /**
   * The patient's communications for the patient timeline (composed in apps/api), when requested: channel, category,
   * template and delivery status only — never the message, its variables or the destination. Suppressed requests
   * (preferences, consent) are included with their status. Notifications have no facility, so a facility filter
   * leaves them out. Not audited here: the caller audits.
   */
  timelineForPatient(organizationId: string, patientId: string, window: TimelineWindow) {
    if (window.facilityIds) return Promise.resolve([]);
    const at = notification.createdAt;
    return this.db
      .select({
        id: notification.id,
        patientId: notification.recipientPatientId,
        at: timelineInstant(at),
        channel: notification.channel,
        category: notification.category,
        templateKey: notification.templateKey,
        status: notification.status,
      })
      .from(notification)
      .where(
        and(
          eq(notification.organizationId, organizationId),
          filedAsPatient(notification.recipientPatientId, patientId),
          timelineRange("communication", at, notification.id, window),
        ),
      )
      .orderBy(desc(at), desc(notification.id))
      .limit(window.limit);
  }

  /** In-app inbox of the signed-in staff member. */
  async inbox(actor: Actor) {
    const rows = await this.db
      .select()
      .from(notification)
      .where(
        and(
          eq(notification.organizationId, actor.organizationId),
          eq(notification.recipientUserId, actor.userId),
          eq(notification.channel, "in_app"),
          eq(notification.status, "delivered"),
        ),
      )
      .orderBy(desc(notification.createdAt))
      .limit(100);
    return rows.map((row) => {
      const template = findTemplate(row.templateKey);
      const rendered = template?.render(row.variables);
      return {
        id: row.id,
        templateKey: row.templateKey,
        subject: rendered?.subject ?? null,
        text: rendered?.text ?? "",
        href: rendered?.href ?? null,
        createdAt: row.createdAt,
        readAt: row.readAt,
      };
    });
  }

  /** Unread in-app messages of the signed-in staff member (the top bar's badge). */
  async unreadCount(actor: Actor): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(notification)
      .where(
        and(
          eq(notification.organizationId, actor.organizationId),
          eq(notification.recipientUserId, actor.userId),
          eq(notification.channel, "in_app"),
          eq(notification.status, "delivered"),
          isNull(notification.readAt),
        ),
      );
    return row?.count ?? 0;
  }

  /**
   * A patient's MyHealth inbox: in-app messages addressed to them, rendered.
   * The caller (the portal) authenticates the patient and audits the read.
   */
  async patientInbox(organizationId: string, patientId: string) {
    const rows = await this.db
      .select()
      .from(notification)
      .where(
        and(
          eq(notification.organizationId, organizationId),
          filedAsPatient(notification.recipientPatientId, patientId),
          eq(notification.channel, "in_app"),
          eq(notification.status, "delivered"),
        ),
      )
      .orderBy(desc(notification.createdAt))
      .limit(100);
    return rows.map((row) => {
      const rendered = findTemplate(row.templateKey)?.render(row.variables);
      return {
        id: row.id,
        templateKey: row.templateKey,
        subject: rendered?.subject ?? null,
        text: rendered?.text ?? "",
        createdAt: row.createdAt,
        readAt: row.readAt,
      };
    });
  }

  async patientUnreadCount(organizationId: string, patientId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(notification)
      .where(
        and(
          eq(notification.organizationId, organizationId),
          filedAsPatient(notification.recipientPatientId, patientId),
          eq(notification.channel, "in_app"),
          eq(notification.status, "delivered"),
          isNull(notification.readAt),
        ),
      );
    return row?.count ?? 0;
  }

  /** Marks one of the patient's own in-app messages read (idempotent); another patient's message is "not found". */
  async markReadForPatient(organizationId: string, patientId: string, notificationId: string): Promise<void> {
    const own = and(
      eq(notification.id, notificationId),
      eq(notification.organizationId, organizationId),
      filedAsPatient(notification.recipientPatientId, patientId),
      eq(notification.channel, "in_app"),
      eq(notification.status, "delivered"),
    );
    const [exists] = await this.db.select({ id: notification.id, readAt: notification.readAt }).from(notification).where(own);
    if (!exists) throw new NotFoundError("Message");
    if (!exists.readAt) await this.db.update(notification).set({ readAt: new Date(), updatedAt: new Date() }).where(own);
  }

  async markRead(actor: Actor, notificationId: string): Promise<void> {
    const updated = await this.db
      .update(notification)
      .set({ readAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(notification.id, notificationId),
          eq(notification.recipientUserId, actor.userId),
          eq(notification.channel, "in_app"),
          isNull(notification.readAt),
        ),
      )
      .returning({ id: notification.id });
    if (updated.length === 0) {
      const [exists] = await this.db
        .select({ id: notification.id })
        .from(notification)
        .where(and(eq(notification.id, notificationId), eq(notification.recipientUserId, actor.userId)));
      if (!exists) throw new NotFoundError("Notification");
    }
  }
}
