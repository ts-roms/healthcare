import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { appUser } from "@healthcare/auth";
import {
  type Actor,
  BusinessRuleError,
  ConflictError,
  DATABASE,
  type Database,
  type DbExecutor,
  DomainEventPublisher,
  filedAsPatient,
  NotFoundError,
} from "@healthcare/core";
import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import { patient } from "../patient.schema";
import { PatientRecordService } from "../patient-record.service";
import { patientAuditContext, PortalAccountService, type PortalPrincipal } from "../portal/portal-account.service";
import type { staffStartThreadSchema, startThreadSchema } from "./patient-message.dto";
import {
  awaitingClinic,
  compareForQueue,
  MAX_OPEN_PATIENT_THREADS,
  MAX_PATIENT_MESSAGES_PER_HOUR,
  type MessageSender,
  shouldNotifyClinic,
  type ThreadQueueFilter,
  unreadByPatient,
} from "./patient-message.rules";
import { patientMessage, patientMessageThread, type PatientMessageRecord, type PatientMessageThreadRecord } from "./patient-message.schema";
import type { MessageView, PortalThreadDetail, PortalThreadView, StaffThreadDetail, StaffThreadView } from "./patient-message.views";

/**
 * Two-way messaging (docs/domains/patient-messaging.md). A conversation is filed under one patient and routed to the
 * facility where the patient is registered. The patient writes in MyHealth; the clinic's staff (`patient.message.read`
 * / `.manage`) read, reply, assign, close and reopen. Messages are append-only, carry text only (no attachments),
 * and are never sent outside MyHealth: the patient is told by SMS or email that a message is waiting, without its
 * content. It is not an emergency channel, and MyHealth says so wherever the patient writes.
 */
@Injectable()
export class PatientMessageService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
    private readonly records: PatientRecordService,
    private readonly portal: PortalAccountService,
  ) {}

  // ---- the patient (MyHealth) --------------------------------------------------------------

  async listForPatient(principal: PortalPrincipal): Promise<PortalThreadView[]> {
    const rows = await this.db
      .select()
      .from(patientMessageThread)
      .where(and(eq(patientMessageThread.organizationId, principal.organizationId), filedAsPatient(patientMessageThread.patientId, principal.patientId)))
      .orderBy(desc(patientMessageThread.lastMessageAt))
      .limit(100);
    await this.audit.recordStandalone(patientAuditContext(principal), {
      action: "portal.message-threads-view",
      resourceType: "patient_message_thread",
      patientId: principal.patientId,
      metadata: { count: rows.length },
    });
    return rows.map((row) => toPortalView(row));
  }

  /** How many conversations hold a clinic message the patient has not read (for the navigation badge). */
  async unreadCountForPatient(principal: PortalPrincipal): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(patientMessageThread)
      .where(
        and(
          eq(patientMessageThread.organizationId, principal.organizationId),
          filedAsPatient(patientMessageThread.patientId, principal.patientId),
          eq(patientMessageThread.lastMessageFrom, "staff"),
          sql`(${patientMessageThread.patientReadThrough} IS NULL OR ${patientMessageThread.patientReadThrough} < ${patientMessageThread.lastMessageAt})`,
        ),
      );
    return row?.count ?? 0;
  }

  /** Opening a conversation reads it: the clinic's messages up to now count as read. */
  async openForPatient(principal: PortalPrincipal, threadId: string): Promise<PortalThreadDetail> {
    return this.db.transaction(async (tx) => {
      const thread = await this.ownThread(tx, principal, threadId);
      const messages = await this.messagesOf(tx, thread.id);
      let current = thread;
      if (unreadByPatient(thread)) {
        const [updated] = await tx
          .update(patientMessageThread)
          .set({ patientReadThrough: thread.lastMessageAt })
          .where(eq(patientMessageThread.id, thread.id))
          .returning();
        current = updated ?? thread;
      }
      await this.audit.record(tx, patientAuditContext(principal), {
        action: "portal.message-thread-view",
        resourceType: "patient_message_thread",
        resourceId: thread.id,
        patientId: principal.patientId,
      });
      return { ...toPortalView(current), messages };
    });
  }

  async startForPatient(principal: PortalPrincipal, input: z.infer<typeof startThreadSchema>): Promise<PortalThreadDetail> {
    return this.db.transaction(async (tx) => {
      // One patient's writing is serialized, so the limits hold.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`patient-message:${principal.patientId}`}))`);
      const [row] = await tx
        .select({ status: patient.status, facilityId: patient.registeredFacilityId })
        .from(patient)
        .where(and(eq(patient.organizationId, principal.organizationId), eq(patient.id, principal.patientId)));
      if (!row) throw new NotFoundError("Patient");
      if (row.status === "merged" || row.status === "deceased") {
        throw new BusinessRuleError("Messages cannot be sent from this record", "messaging_not_available");
      }
      const [open] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(patientMessageThread)
        .where(
          and(
            filedAsPatient(patientMessageThread.patientId, principal.patientId),
            eq(patientMessageThread.status, "open"),
            eq(patientMessageThread.startedBy, "patient"),
          ),
        );
      if ((open?.count ?? 0) >= MAX_OPEN_PATIENT_THREADS) {
        throw new ConflictError(
          `You already have ${MAX_OPEN_PATIENT_THREADS} open conversations. Wait for the clinic to answer one, then start a new one.`,
          undefined,
          "too_many_open_threads",
        );
      }
      await this.assertPatientRate(tx, principal.patientId);
      const now = new Date();
      const [thread] = await tx
        .insert(patientMessageThread)
        .values({
          organizationId: principal.organizationId,
          patientId: principal.patientId,
          facilityId: row.facilityId,
          topic: input.topic,
          subject: input.subject,
          startedBy: "patient",
          messageCount: 1,
          lastMessageAt: now,
          lastMessageFrom: "patient",
        })
        .returning();
      const message = await this.insertMessage(
        tx,
        thread!,
        "patient",
        { accountId: principal.accountId, viaGuardian: Boolean(principal.proxy) },
        input.body,
        now,
      );
      await this.record(tx, patientAuditContext(principal), thread!, message, "portal.message-send", true);
      return { ...toPortalView(thread!), messages: [toMessageView(message, null)] };
    });
  }

  async replyForPatient(principal: PortalPrincipal, threadId: string, body: string): Promise<PortalThreadDetail> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`patient-message:${principal.patientId}`}))`);
      const thread = await this.ownThread(tx, principal, threadId, true);
      if (thread.status === "closed") {
        throw new BusinessRuleError("This conversation is closed. Start a new message if you need the clinic.", "thread_closed");
      }
      await this.assertPatientRate(tx, principal.patientId);
      const now = new Date();
      const notify = shouldNotifyClinic(thread.lastMessageFrom);
      const [updated] = await tx
        .update(patientMessageThread)
        .set({
          messageCount: sql`${patientMessageThread.messageCount} + 1`,
          lastMessageAt: now,
          lastMessageFrom: "patient",
          // Their own writing means they have seen everything before it.
          patientReadThrough: now,
          version: sql`${patientMessageThread.version} + 1`,
        })
        .where(eq(patientMessageThread.id, thread.id))
        .returning();
      const message = await this.insertMessage(tx, updated!, "patient", { accountId: principal.accountId, viaGuardian: Boolean(principal.proxy) }, body, now);
      await this.record(tx, patientAuditContext(principal), updated!, message, "portal.message-send", notify);
      return { ...toPortalView(updated!), messages: await this.messagesOf(tx, thread.id) };
    });
  }

  // ---- the clinic (staff) -------------------------------------------------------------------

  async listForStaff(
    actor: Actor,
    query: { filter: ThreadQueueFilter; facilityId?: string; patientId?: string; assignedToMe?: boolean },
  ): Promise<StaffThreadView[]> {
    const conditions = [eq(patientMessageThread.organizationId, actor.organizationId)];
    if (query.facilityId) conditions.push(eq(patientMessageThread.facilityId, query.facilityId));
    if (query.patientId) conditions.push(filedAsPatient(patientMessageThread.patientId, query.patientId));
    if (query.assignedToMe) conditions.push(eq(patientMessageThread.assignedTo, actor.userId));
    if (query.filter === "closed") conditions.push(eq(patientMessageThread.status, "closed"));
    if (query.filter === "open" || query.filter === "awaiting") conditions.push(eq(patientMessageThread.status, "open"));
    if (query.filter === "awaiting") conditions.push(eq(patientMessageThread.lastMessageFrom, "patient"));
    const rows = await this.db
      .select()
      .from(patientMessageThread)
      .where(and(...conditions))
      .orderBy(desc(patientMessageThread.lastMessageAt))
      .limit(300);
    rows.sort(compareForQueue);
    return this.staffViews(actor.organizationId, rows);
  }

  /** How many conversations wait for the clinic (for the staff badge and dashboard). */
  async awaitingCount(actor: Actor): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(patientMessageThread)
      .where(
        and(
          eq(patientMessageThread.organizationId, actor.organizationId),
          eq(patientMessageThread.status, "open"),
          eq(patientMessageThread.lastMessageFrom, "patient"),
        ),
      );
    return row?.count ?? 0;
  }

  async getForStaff(actor: Actor, threadId: string): Promise<StaffThreadDetail> {
    const thread = await this.staffThread(this.db, actor, threadId);
    const [view] = await this.staffViews(actor.organizationId, [thread]);
    const messages = await this.messagesOf(this.db, thread.id);
    await this.audit.recordStandalone(actor, {
      action: "patient.message-thread-view",
      resourceType: "patient_message_thread",
      resourceId: thread.id,
      patientId: thread.patientId,
    });
    return { ...view!, messages };
  }

  async replyForStaff(actor: Actor, threadId: string, body: string): Promise<StaffThreadDetail> {
    const detail = await this.db.transaction(async (tx) => {
      const thread = await this.staffThread(tx, actor, threadId, true);
      if (thread.status === "closed") throw new BusinessRuleError("Reopen the conversation to reply", "thread_closed");
      const now = new Date();
      const [updated] = await tx
        .update(patientMessageThread)
        .set({
          messageCount: sql`${patientMessageThread.messageCount} + 1`,
          lastMessageAt: now,
          lastMessageFrom: "staff",
          // A reply takes the conversation, unless someone else has it.
          assignedTo: thread.assignedTo ?? actor.userId,
          version: sql`${patientMessageThread.version} + 1`,
        })
        .where(eq(patientMessageThread.id, thread.id))
        .returning();
      const message = await this.insertMessage(tx, updated!, "staff", { userId: actor.userId }, body, now);
      await this.record(tx, actor, updated!, message, "patient.message-reply", true);
      return updated!;
    });
    return this.getForStaffQuiet(actor, detail);
  }

  /** The clinic starts a conversation with a patient who uses MyHealth (so the patient can answer). */
  async startForStaff(actor: Actor, input: z.infer<typeof staffStartThreadSchema>): Promise<StaffThreadDetail> {
    const thread = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ status: patient.status, facilityId: patient.registeredFacilityId })
        .from(patient)
        .where(and(eq(patient.organizationId, actor.organizationId), eq(patient.id, input.patientId)));
      if (!row) throw new NotFoundError("Patient");
      if (row.status !== "active") throw new BusinessRuleError(`A ${row.status} patient cannot be messaged`, "patient_not_active");
      if (!(await this.portal.canUsePortal(actor.organizationId, input.patientId))) {
        throw new BusinessRuleError("The patient does not use MyHealth, so they cannot read or answer messages", "no_portal_account");
      }
      const now = new Date();
      const [created] = await tx
        .insert(patientMessageThread)
        .values({
          organizationId: actor.organizationId,
          patientId: input.patientId,
          facilityId: row.facilityId,
          topic: input.topic,
          subject: input.subject,
          startedBy: "staff",
          assignedTo: actor.userId,
          messageCount: 1,
          lastMessageAt: now,
          lastMessageFrom: "staff",
        })
        .returning();
      const message = await this.insertMessage(tx, created!, "staff", { userId: actor.userId }, input.body, now);
      await this.record(tx, actor, created!, message, "patient.message-start", true);
      return created!;
    });
    return this.getForStaffQuiet(actor, thread);
  }

  async assign(actor: Actor, threadId: string, assignToMe: boolean): Promise<StaffThreadDetail> {
    const thread = await this.db.transaction(async (tx) => {
      const current = await this.staffThread(tx, actor, threadId, true);
      const [updated] = await tx
        .update(patientMessageThread)
        .set({ assignedTo: assignToMe ? actor.userId : null, version: sql`${patientMessageThread.version} + 1` })
        .where(eq(patientMessageThread.id, current.id))
        .returning();
      await this.audit.record(tx, actor, {
        action: "patient.message-assign",
        resourceType: "patient_message_thread",
        resourceId: current.id,
        patientId: current.patientId,
        changes: { assignedTo: { from: current.assignedTo, to: updated!.assignedTo } },
      });
      return updated!;
    });
    return this.getForStaffQuiet(actor, thread);
  }

  async setStatus(actor: Actor, threadId: string, status: "open" | "closed"): Promise<StaffThreadDetail> {
    const thread = await this.db.transaction(async (tx) => {
      const current = await this.staffThread(tx, actor, threadId, true);
      if (current.status === status) return current;
      const [updated] = await tx
        .update(patientMessageThread)
        .set({
          status,
          closedAt: status === "closed" ? new Date() : null,
          closedBy: status === "closed" ? actor.userId : null,
          version: sql`${patientMessageThread.version} + 1`,
        })
        .where(eq(patientMessageThread.id, current.id))
        .returning();
      await this.audit.record(tx, actor, {
        action: status === "closed" ? "patient.message-close" : "patient.message-reopen",
        resourceType: "patient_message_thread",
        resourceId: current.id,
        patientId: current.patientId,
      });
      return updated!;
    });
    return this.getForStaffQuiet(actor, thread);
  }

  // ---- internals ------------------------------------------------------------------------

  private async ownThread(executor: DbExecutor, principal: PortalPrincipal, threadId: string, lock = false): Promise<PatientMessageThreadRecord> {
    const query = executor
      .select()
      .from(patientMessageThread)
      .where(
        and(
          eq(patientMessageThread.organizationId, principal.organizationId),
          eq(patientMessageThread.id, threadId),
          filedAsPatient(patientMessageThread.patientId, principal.patientId),
        ),
      );
    const [row] = lock ? await query.for("update") : await query;
    if (!row) throw new NotFoundError("Conversation");
    return row;
  }

  private async staffThread(executor: DbExecutor, actor: Actor, threadId: string, lock = false): Promise<PatientMessageThreadRecord> {
    const query = executor
      .select()
      .from(patientMessageThread)
      .where(and(eq(patientMessageThread.organizationId, actor.organizationId), eq(patientMessageThread.id, threadId)));
    const [row] = lock ? await query.for("update") : await query;
    if (!row) throw new NotFoundError("Conversation");
    return row;
  }

  private async assertPatientRate(tx: DbExecutor, patientId: string): Promise<void> {
    const [row] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(patientMessage)
      .where(
        and(
          filedAsPatient(patientMessage.patientId, patientId),
          eq(patientMessage.senderType, "patient"),
          gt(patientMessage.createdAt, new Date(Date.now() - 3_600_000)),
        ),
      );
    if ((row?.count ?? 0) >= MAX_PATIENT_MESSAGES_PER_HOUR) {
      throw new BusinessRuleError("You have sent many messages in the last hour. Try again later, or call the clinic.", "message_rate_limited");
    }
  }

  private async insertMessage(
    tx: DbExecutor,
    thread: PatientMessageThreadRecord,
    sender: MessageSender,
    by: { accountId?: string; userId?: string; viaGuardian?: boolean },
    body: string,
    at: Date,
  ): Promise<PatientMessageRecord> {
    const [message] = await tx
      .insert(patientMessage)
      .values({
        organizationId: thread.organizationId,
        threadId: thread.id,
        patientId: thread.patientId,
        senderType: sender,
        senderPortalAccountId: by.accountId ?? null,
        senderUserId: by.userId ?? null,
        body,
        viaGuardian: by.viaGuardian ?? false,
        createdAt: at,
      })
      .returning();
    return message!;
  }

  /** Audits a message and records the event (ids only: a message's text never travels through the outbox). */
  private async record(
    tx: DbExecutor,
    context: Parameters<AuditService["record"]>[1],
    thread: PatientMessageThreadRecord,
    message: PatientMessageRecord,
    action: string,
    notify: boolean,
  ): Promise<void> {
    await this.audit.record(tx, context, {
      action,
      resourceType: "patient_message_thread",
      resourceId: thread.id,
      patientId: thread.patientId,
      metadata: { messageId: message.id, topic: thread.topic },
    });
    await this.events.record(tx, {
      type: "PatientMessageSent",
      organizationId: thread.organizationId,
      facilityId: thread.facilityId,
      aggregateType: "patient_message_thread",
      aggregateId: thread.id,
      patientId: thread.patientId,
      payload: { threadId: thread.id, messageId: message.id, sender: message.senderType, notify },
    });
  }

  private async messagesOf(executor: DbExecutor, threadId: string): Promise<MessageView[]> {
    const rows = await executor
      .select({ message: patientMessage, staffName: appUser.displayName })
      .from(patientMessage)
      .leftJoin(appUser, eq(appUser.id, patientMessage.senderUserId))
      .where(eq(patientMessage.threadId, threadId))
      .orderBy(asc(patientMessage.createdAt), asc(patientMessage.id));
    return rows.map((r) => toMessageView(r.message, r.staffName));
  }

  private async staffViews(organizationId: string, rows: PatientMessageThreadRecord[]): Promise<StaffThreadView[]> {
    const patientIds = [...new Set(rows.map((r) => r.patientId))];
    const briefs = await this.records.briefs(organizationId, patientIds);
    const userIds = [...new Set(rows.map((r) => r.assignedTo).filter((id): id is string => Boolean(id)))];
    const users = userIds.length
      ? new Map(
          (await this.db.select({ id: appUser.id, displayName: appUser.displayName }).from(appUser).where(inArray(appUser.id, userIds))).map((u) => [u.id, u]),
        )
      : new Map<string, { id: string; displayName: string }>();
    return rows.map((row) => ({
      ...toPortalView(row),
      // The clinic's own "unread" is not the patient's: what matters to staff is who is waiting.
      unread: false,
      patientId: row.patientId,
      patientNumber: briefs.get(row.patientId)?.patientNumber ?? "",
      patientName: briefs.get(row.patientId)?.displayName ?? "Unknown patient",
      facilityId: row.facilityId,
      assignedTo: row.assignedTo ? (users.get(row.assignedTo) ?? null) : null,
      awaitingClinic: awaitingClinic(row),
      closedAt: row.closedAt?.toISOString() ?? null,
      version: row.version,
    }));
  }

  private async getForStaffQuiet(actor: Actor, thread: PatientMessageThreadRecord): Promise<StaffThreadDetail> {
    const [view] = await this.staffViews(actor.organizationId, [thread]);
    return { ...view!, messages: await this.messagesOf(this.db, thread.id) };
  }
}

function toPortalView(thread: PatientMessageThreadRecord, unreadOverride?: boolean): PortalThreadView {
  return {
    id: thread.id,
    topic: thread.topic,
    subject: thread.subject,
    status: thread.status,
    startedBy: thread.startedBy,
    messageCount: thread.messageCount,
    lastMessageAt: thread.lastMessageAt.toISOString(),
    lastMessageFrom: thread.lastMessageFrom,
    unread: unreadOverride ?? unreadByPatient(thread),
  };
}

function toMessageView(message: PatientMessageRecord, staffName: string | null): MessageView {
  return {
    id: message.id,
    sender: message.senderType,
    senderName: message.senderType === "staff" ? staffName : null,
    body: message.body,
    viaGuardian: message.viaGuardian,
    createdAt: message.createdAt.toISOString(),
  };
}
