import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { appUser, organizationMembership } from "@healthcare/auth";
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
import { document, DocumentsService } from "@healthcare/documents";
import { OrganizationService } from "@healthcare/organization";
import { and, asc, desc, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import type { z } from "zod";
import { patient } from "../patient.schema";
import { PatientRecordService } from "../patient-record.service";
import { patientAuditContext, PortalAccountService, type PortalPrincipal } from "../portal/portal-account.service";
import type { patientUploadSchema, staffStartThreadSchema, startThreadSchema, upsertSettingSchema } from "./patient-message.dto";
import {
  awaitingClinic,
  compareForQueue,
  initialAssignee,
  isOverdue,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_OPEN_PATIENT_THREADS,
  MAX_PATIENT_MESSAGES_PER_HOUR,
  MAX_PATIENT_UPLOADS_PER_DAY,
  type MessageSender,
  type MessageTopic,
  overdueReminderDue,
  responseDueAt,
  shouldNotifyClinic,
  type ThreadQueueFilter,
  unreadByPatient,
} from "./patient-message.rules";
import {
  patientMessage,
  patientMessageAttachment,
  patientMessageNote,
  patientMessageSetting,
  patientMessageThread,
  type PatientMessageRecord,
  type PatientMessageSettingRecord,
  type PatientMessageThreadRecord,
} from "./patient-message.schema";
import type {
  AttachmentView,
  MessageSettingView,
  MessageView,
  NoteView,
  PortalThreadDetail,
  PortalThreadView,
  StaffThreadDetail,
  StaffThreadView,
} from "./patient-message.views";

/**
 * Two-way messaging (docs/domains/patient-messaging.md). A conversation is filed under one patient and routed to the
 * facility where the patient is registered. The patient writes in MyHealth; the clinic's staff (`patient.message.read`
 * / `.manage`) read, reply, assign, close and reopen. Messages are append-only, carry text and up to three documents
 * of the patient's record (migration 0097: images or PDFs the patient uploads, or documents the clinic holds), and are
 * never sent outside MyHealth: the patient is told by SMS or email that a message is waiting, without its content.
 * Staff may keep notes the patient never sees; each facility may route topics to a role or a person and set a
 * response target. It is not an emergency channel, and MyHealth says so wherever the patient writes.
 */
@Injectable()
export class PatientMessageService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
    private readonly records: PatientRecordService,
    private readonly portal: PortalAccountService,
    private readonly documents: DocumentsService,
    private readonly organizations: OrganizationService,
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
      const attachments = await this.patientAttachments(tx, principal, input.documentIds);
      const now = new Date();
      // The facility's routing and target for this topic (migration 0097).
      const setting = await this.settingFor(tx, principal.organizationId, row.facilityId, input.topic);
      const [thread] = await tx
        .insert(patientMessageThread)
        .values({
          organizationId: principal.organizationId,
          patientId: principal.patientId,
          facilityId: row.facilityId,
          topic: input.topic,
          subject: input.subject,
          startedBy: "patient",
          assignedTo: initialAssignee(setting),
          messageCount: 1,
          lastMessageAt: now,
          lastMessageFrom: "patient",
          responseDueAt: responseDueAt(setting, now),
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
      const attached = await this.attach(tx, thread!, message, attachments);
      await this.record(tx, patientAuditContext(principal), thread!, message, "portal.message-send", true, attached.length);
      return { ...toPortalView(thread!), messages: [toMessageView(message, null, attached)] };
    });
  }

  async replyForPatient(principal: PortalPrincipal, threadId: string, body: string, documentIds: string[] = []): Promise<PortalThreadDetail> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`patient-message:${principal.patientId}`}))`);
      const thread = await this.ownThread(tx, principal, threadId, true);
      if (thread.status === "closed") {
        throw new BusinessRuleError("This conversation is closed. Start a new message if you need the clinic.", "thread_closed");
      }
      await this.assertPatientRate(tx, principal.patientId);
      const attachments = await this.patientAttachments(tx, principal, documentIds);
      const now = new Date();
      const notify = shouldNotifyClinic(thread.lastMessageFrom);
      // The target counts from the message that started the wait; a further message does not restart it.
      const setting = notify ? await this.settingFor(tx, thread.organizationId, thread.facilityId, thread.topic) : null;
      const [updated] = await tx
        .update(patientMessageThread)
        .set({
          messageCount: sql`${patientMessageThread.messageCount} + 1`,
          lastMessageAt: now,
          lastMessageFrom: "patient",
          // Their own writing means they have seen everything before it.
          patientReadThrough: now,
          ...(notify ? { responseDueAt: responseDueAt(setting, now), overdueNotifiedAt: null } : {}),
          version: sql`${patientMessageThread.version} + 1`,
        })
        .where(eq(patientMessageThread.id, thread.id))
        .returning();
      const message = await this.insertMessage(tx, updated!, "patient", { accountId: principal.accountId, viaGuardian: Boolean(principal.proxy) }, body, now);
      const attached = await this.attach(tx, updated!, message, attachments);
      await this.record(tx, patientAuditContext(principal), updated!, message, "portal.message-send", notify, attached.length);
      return { ...toPortalView(updated!), messages: await this.messagesOf(tx, thread.id) };
    });
  }

  /** A short-lived link to a document carried by one of the patient's conversations (audited as the patient). */
  async attachmentLinkForPatient(principal: PortalPrincipal, threadId: string, documentId: string) {
    const thread = await this.ownThread(this.db, principal, threadId);
    const [row] = await this.db
      .select({ id: patientMessageAttachment.id })
      .from(patientMessageAttachment)
      .where(and(eq(patientMessageAttachment.threadId, thread.id), eq(patientMessageAttachment.documentId, documentId)))
      .limit(1);
    if (!row) throw new NotFoundError("Document");
    return this.documents.downloadUrlForPatient(patientAuditContext(principal), documentId);
  }

  /** A patient's own upload for a message (an image or a PDF; ten a day). */
  async startPatientUpload(principal: PortalPrincipal, input: z.infer<typeof patientUploadSchema>) {
    const context = patientAuditContext(principal);
    if ((await this.documents.patientUploadsToday(context)) >= MAX_PATIENT_UPLOADS_PER_DAY) {
      throw new BusinessRuleError("You have uploaded many files today. Try again tomorrow, or call the clinic.", "upload_rate_limited");
    }
    return this.documents.createForPatient(context, input);
  }

  completePatientUpload(principal: PortalPrincipal, documentId: string) {
    return this.documents.completeUploadForPatient(patientAuditContext(principal), documentId);
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
    const notes = await this.notesOf(this.db, thread.id);
    await this.audit.recordStandalone(actor, {
      action: "patient.message-thread-view",
      resourceType: "patient_message_thread",
      resourceId: thread.id,
      patientId: thread.patientId,
    });
    return { ...view!, messages, notes };
  }

  async replyForStaff(actor: Actor, threadId: string, body: string, documentIds: string[] = []): Promise<StaffThreadDetail> {
    const detail = await this.db.transaction(async (tx) => {
      const thread = await this.staffThread(tx, actor, threadId, true);
      if (thread.status === "closed") throw new BusinessRuleError("Reopen the conversation to reply", "thread_closed");
      const attachments = await this.staffAttachments(tx, actor, thread.patientId, documentIds);
      const now = new Date();
      const [updated] = await tx
        .update(patientMessageThread)
        .set({
          messageCount: sql`${patientMessageThread.messageCount} + 1`,
          lastMessageAt: now,
          lastMessageFrom: "staff",
          // A reply takes the conversation, unless someone else has it; it ends the wait the target measured.
          assignedTo: thread.assignedTo ?? actor.userId,
          responseDueAt: null,
          version: sql`${patientMessageThread.version} + 1`,
        })
        .where(eq(patientMessageThread.id, thread.id))
        .returning();
      const message = await this.insertMessage(tx, updated!, "staff", { userId: actor.userId }, body, now);
      const attached = await this.attach(tx, updated!, message, attachments);
      await this.record(tx, actor, updated!, message, "patient.message-reply", true, attached.length);
      return updated!;
    });
    return this.getForStaffQuiet(actor, detail);
  }

  /** A staff-only note on a conversation (never shown to the patient; audited with ids only). */
  async addNote(actor: Actor, threadId: string, body: string): Promise<StaffThreadDetail> {
    const thread = await this.db.transaction(async (tx) => {
      const current = await this.staffThread(tx, actor, threadId, true);
      const [note] = await tx
        .insert(patientMessageNote)
        .values({ organizationId: actor.organizationId, threadId: current.id, patientId: current.patientId, authorUserId: actor.userId, body })
        .returning();
      await this.audit.record(tx, actor, {
        action: "patient.message-note",
        resourceType: "patient_message_thread",
        resourceId: current.id,
        patientId: current.patientId,
        metadata: { noteId: note!.id },
      });
      return current;
    });
    return this.getForStaffQuiet(actor, thread);
  }

  /** A short-lived link for staff to a document carried by a conversation (audited; needs the documents permission). */
  async attachmentLinkForStaff(actor: Actor, threadId: string, documentId: string) {
    const thread = await this.staffThread(this.db, actor, threadId);
    const [row] = await this.db
      .select({ id: patientMessageAttachment.id })
      .from(patientMessageAttachment)
      .where(and(eq(patientMessageAttachment.threadId, thread.id), eq(patientMessageAttachment.documentId, documentId)))
      .limit(1);
    if (!row) throw new NotFoundError("Document");
    return this.documents.downloadUrl(actor, documentId);
  }

  // ---- routing and response targets (migration 0097) ---------------------------------------------------------------

  async listSettings(actor: Actor, facilityId: string): Promise<MessageSettingView[]> {
    await this.organizations.getFacility(actor.organizationId, facilityId);
    const rows = await this.db
      .select({ setting: patientMessageSetting, userName: appUser.displayName })
      .from(patientMessageSetting)
      .leftJoin(appUser, eq(appUser.id, patientMessageSetting.routeUserId))
      .where(and(eq(patientMessageSetting.organizationId, actor.organizationId), eq(patientMessageSetting.facilityId, facilityId)))
      .orderBy(asc(patientMessageSetting.topic));
    return rows.map((r) => toSettingView(r.setting, r.userName));
  }

  /** Sets (or first creates) the routing and target for one topic at a facility (clinic.configure; audited). */
  async upsertSetting(actor: Actor, input: z.infer<typeof upsertSettingSchema>): Promise<MessageSettingView> {
    await this.organizations.getFacility(actor.organizationId, input.facilityId);
    if (input.routeUserId) {
      // Only a member of this organization can be routed to.
      const [member] = await this.db
        .select({ id: organizationMembership.userId })
        .from(organizationMembership)
        .where(and(eq(organizationMembership.organizationId, actor.organizationId), eq(organizationMembership.userId, input.routeUserId)));
      if (!member) throw new NotFoundError("User");
    }
    const fields = {
      routeRoleKey: input.routeRoleKey ?? null,
      routeUserId: input.routeUserId ?? null,
      autoAssign: input.autoAssign,
      responseTargetHours: input.responseTargetHours ?? null,
    };
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(patientMessageSetting)
        .where(and(eq(patientMessageSetting.facilityId, input.facilityId), eq(patientMessageSetting.topic, input.topic)))
        .for("update");
      if (current && current.version !== (input.version ?? -1)) {
        throw new ConflictError("The settings were changed by someone else; reload and try again", { version: current.version }, "version_conflict");
      }
      const [saved] = current
        ? await tx
            .update(patientMessageSetting)
            .set({ ...fields, updatedBy: actor.userId, updatedAt: new Date(), version: current.version + 1 })
            .where(eq(patientMessageSetting.id, current.id))
            .returning()
        : await tx
            .insert(patientMessageSetting)
            .values({ ...fields, organizationId: actor.organizationId, facilityId: input.facilityId, topic: input.topic, updatedBy: actor.userId })
            .returning();
      await this.audit.record(tx, actor, {
        action: "patient.message-settings-update",
        resourceType: "patient_message_setting",
        resourceId: saved!.id,
        changes: Object.fromEntries(
          (Object.keys(fields) as Array<keyof typeof fields>)
            .filter((k) => (current ? current[k] : null) !== fields[k])
            .map((k) => [k, { from: current ? current[k] : null, to: fields[k] }]),
        ),
        metadata: { facilityId: input.facilityId, topic: input.topic },
      });
      const userName = saved!.routeUserId
        ? ((await tx.select({ name: appUser.displayName }).from(appUser).where(eq(appUser.id, saved!.routeUserId)))[0]?.name ?? null)
        : null;
      return toSettingView(saved!, userName);
    });
  }

  /** Who a new patient message of this conversation is routed to (for the notice handler). */
  async routingOf(
    organizationId: string,
    threadId: string,
  ): Promise<{ assignedTo: string | null; routeRoleKey: string | null; routeUserId: string | null; facilityId: string | null }> {
    const [thread] = await this.db
      .select({ assignedTo: patientMessageThread.assignedTo, facilityId: patientMessageThread.facilityId, topic: patientMessageThread.topic })
      .from(patientMessageThread)
      .where(and(eq(patientMessageThread.organizationId, organizationId), eq(patientMessageThread.id, threadId)));
    if (!thread) return { assignedTo: null, routeRoleKey: null, routeUserId: null, facilityId: null };
    const setting = await this.settingFor(this.db, organizationId, thread.facilityId, thread.topic);
    return {
      assignedTo: thread.assignedTo,
      routeRoleKey: setting?.routeRoleKey ?? null,
      routeUserId: setting?.routeUserId ?? null,
      facilityId: thread.facilityId,
    };
  }

  /** How many conversations wait past their target (for the staff badge and the dashboard). */
  async overdueCount(actor: Actor, now = new Date()): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(patientMessageThread)
      .where(
        and(
          eq(patientMessageThread.organizationId, actor.organizationId),
          eq(patientMessageThread.status, "open"),
          eq(patientMessageThread.lastMessageFrom, "patient"),
          lte(patientMessageThread.responseDueAt, now),
        ),
      );
    return row?.count ?? 0;
  }

  /**
   * Conversations past their target whose breach nobody was reminded of yet (the hourly reminder); marking happens
   * through {@link markOverdueNotified} once the notices are queued.
   */
  async overdueToRemind(
    now = new Date(),
  ): Promise<
    Array<{ id: string; organizationId: string; facilityId: string; patientId: string; topic: MessageTopic; assignedTo: string | null; responseDueAt: Date }>
  > {
    const rows = await this.db
      .select()
      .from(patientMessageThread)
      .where(and(eq(patientMessageThread.status, "open"), eq(patientMessageThread.lastMessageFrom, "patient"), lte(patientMessageThread.responseDueAt, now)))
      .orderBy(asc(patientMessageThread.responseDueAt))
      .limit(500);
    return rows
      .filter((t) => overdueReminderDue(t, now))
      .map((t) => ({
        id: t.id,
        organizationId: t.organizationId,
        facilityId: t.facilityId,
        patientId: t.patientId,
        topic: t.topic,
        assignedTo: t.assignedTo,
        responseDueAt: t.responseDueAt as Date,
      }));
  }

  async markOverdueNotified(threadId: string, now = new Date()): Promise<void> {
    await this.db
      .update(patientMessageThread)
      .set({ overdueNotifiedAt: now })
      .where(and(eq(patientMessageThread.id, threadId), isNull(patientMessageThread.overdueNotifiedAt)));
    await this.db
      .update(patientMessageThread)
      .set({ overdueNotifiedAt: now })
      .where(and(eq(patientMessageThread.id, threadId), lte(patientMessageThread.overdueNotifiedAt, patientMessageThread.responseDueAt)));
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
    attachmentCount = 0,
  ): Promise<void> {
    await this.audit.record(tx, context, {
      action,
      resourceType: "patient_message_thread",
      resourceId: thread.id,
      patientId: thread.patientId,
      metadata: { messageId: message.id, topic: thread.topic, attachments: attachmentCount },
    });
    await this.events.record(tx, {
      type: "PatientMessageSent",
      organizationId: thread.organizationId,
      facilityId: thread.facilityId,
      aggregateType: "patient_message_thread",
      aggregateId: thread.id,
      patientId: thread.patientId,
      payload: { threadId: thread.id, messageId: message.id, sender: message.senderType, notify, attachments: attachmentCount },
    });
  }

  private async messagesOf(executor: DbExecutor, threadId: string): Promise<MessageView[]> {
    const rows = await executor
      .select({ message: patientMessage, staffName: appUser.displayName })
      .from(patientMessage)
      .leftJoin(appUser, eq(appUser.id, patientMessage.senderUserId))
      .where(eq(patientMessage.threadId, threadId))
      .orderBy(asc(patientMessage.createdAt), asc(patientMessage.id));
    const attachments = await executor
      .select({ messageId: patientMessageAttachment.messageId, position: patientMessageAttachment.position, doc: document })
      .from(patientMessageAttachment)
      .innerJoin(document, eq(document.id, patientMessageAttachment.documentId))
      .where(eq(patientMessageAttachment.threadId, threadId))
      .orderBy(asc(patientMessageAttachment.position));
    const byMessage = new Map<string, AttachmentView[]>();
    for (const a of attachments) byMessage.set(a.messageId, [...(byMessage.get(a.messageId) ?? []), toAttachmentView(a.doc)]);
    return rows.map((r) => toMessageView(r.message, r.staffName, byMessage.get(r.message.id) ?? []));
  }

  private async notesOf(executor: DbExecutor, threadId: string): Promise<NoteView[]> {
    const rows = await executor
      .select({ note: patientMessageNote, authorName: appUser.displayName })
      .from(patientMessageNote)
      .leftJoin(appUser, eq(appUser.id, patientMessageNote.authorUserId))
      .where(eq(patientMessageNote.threadId, threadId))
      .orderBy(asc(patientMessageNote.createdAt), asc(patientMessageNote.id));
    return rows.map((r) => ({ id: r.note.id, authorName: r.authorName, body: r.note.body, createdAt: r.note.createdAt.toISOString() }));
  }

  private async settingFor(executor: DbExecutor, organizationId: string, facilityId: string, topic: MessageTopic): Promise<PatientMessageSettingRecord | null> {
    const [row] = await executor
      .select()
      .from(patientMessageSetting)
      .where(
        and(eq(patientMessageSetting.organizationId, organizationId), eq(patientMessageSetting.facilityId, facilityId), eq(patientMessageSetting.topic, topic)),
      );
    return row ?? null;
  }

  /** The patient's own uploads (available, their account's) they may attach; others are not theirs to send. */
  private async patientAttachments(executor: DbExecutor, principal: PortalPrincipal, documentIds: string[]): Promise<Array<typeof document.$inferSelect>> {
    if (!documentIds.length) return [];
    const ids = [...new Set(documentIds)].slice(0, MAX_ATTACHMENTS_PER_MESSAGE);
    const rows = await executor
      .select()
      .from(document)
      .where(
        and(
          eq(document.organizationId, principal.organizationId),
          inArray(document.id, ids),
          eq(document.createdByPortalAccount, principal.accountId),
          filedAsPatient(document.patientId, principal.patientId),
          eq(document.status, "available"),
        ),
      );
    if (rows.length !== ids.length) throw new BusinessRuleError("Attach only files you uploaded here that finished uploading", "attachment_not_allowed");
    return ids.map((id) => rows.find((r) => r.id === id)!);
  }

  /** Documents of the patient's record the clinic holds (available, not managed by another domain). */
  private async staffAttachments(executor: DbExecutor, actor: Actor, patientId: string, documentIds: string[]): Promise<Array<typeof document.$inferSelect>> {
    if (!documentIds.length) return [];
    const ids = [...new Set(documentIds)].slice(0, MAX_ATTACHMENTS_PER_MESSAGE);
    const rows = await executor
      .select()
      .from(document)
      .where(
        and(
          eq(document.organizationId, actor.organizationId),
          inArray(document.id, ids),
          filedAsPatient(document.patientId, patientId),
          eq(document.status, "available"),
          isNull(document.managedBy),
        ),
      );
    if (rows.length !== ids.length) throw new BusinessRuleError("Attach only available documents of this patient's record", "attachment_not_allowed");
    return ids.map((id) => rows.find((r) => r.id === id)!);
  }

  private async attach(
    tx: DbExecutor,
    thread: PatientMessageThreadRecord,
    message: PatientMessageRecord,
    docs: Array<typeof document.$inferSelect>,
  ): Promise<AttachmentView[]> {
    if (!docs.length) return [];
    await tx.insert(patientMessageAttachment).values(
      docs.map((d, position) => ({
        organizationId: thread.organizationId,
        patientId: d.patientId!,
        threadId: thread.id,
        messageId: message.id,
        documentId: d.id,
        position,
      })),
    );
    return docs.map(toAttachmentView);
  }

  private async staffViews(organizationId: string, rows: PatientMessageThreadRecord[]): Promise<StaffThreadView[]> {
    const patientIds = [...new Set(rows.map((r) => r.patientId))];
    const briefs = await this.records.briefs(organizationId, patientIds);
    const now = new Date();
    const noteCounts = rows.length
      ? new Map(
          (
            await this.db
              .select({ threadId: patientMessageNote.threadId, count: sql<number>`count(*)::int` })
              .from(patientMessageNote)
              .where(
                inArray(
                  patientMessageNote.threadId,
                  rows.map((r) => r.id),
                ),
              )
              .groupBy(patientMessageNote.threadId)
          ).map((r) => [r.threadId, r.count]),
        )
      : new Map<string, number>();
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
      responseDueAt: awaitingClinic(row) ? (row.responseDueAt?.toISOString() ?? null) : null,
      overdue: isOverdue(row, now),
      noteCount: noteCounts.get(row.id) ?? 0,
      closedAt: row.closedAt?.toISOString() ?? null,
      version: row.version,
    }));
  }

  private async getForStaffQuiet(actor: Actor, thread: PatientMessageThreadRecord): Promise<StaffThreadDetail> {
    const [view] = await this.staffViews(actor.organizationId, [thread]);
    return { ...view!, messages: await this.messagesOf(this.db, thread.id), notes: await this.notesOf(this.db, thread.id) };
  }
}

function toAttachmentView(d: typeof document.$inferSelect): AttachmentView {
  return { documentId: d.id, title: d.title, fileName: d.fileName, contentType: d.contentType, sizeBytes: d.sizeBytes };
}

function toSettingView(row: PatientMessageSettingRecord, routeUserName: string | null): MessageSettingView {
  return {
    id: row.id,
    facilityId: row.facilityId,
    topic: row.topic,
    routeRoleKey: row.routeRoleKey,
    routeUserId: row.routeUserId,
    routeUserName,
    autoAssign: row.autoAssign,
    responseTargetHours: row.responseTargetHours,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
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

function toMessageView(message: PatientMessageRecord, staffName: string | null, attachments: AttachmentView[]): MessageView {
  return {
    id: message.id,
    sender: message.senderType,
    senderName: message.senderType === "staff" ? staffName : null,
    body: message.body,
    viaGuardian: message.viaGuardian,
    createdAt: message.createdAt.toISOString(),
    attachments,
  };
}
