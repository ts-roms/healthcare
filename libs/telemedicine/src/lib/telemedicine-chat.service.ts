import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { type Actor, BusinessRuleError, DATABASE, type Database, isFiledAs, NotFoundError, requireFacilityId } from "@healthcare/core";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { type OnlineAppointment, TELEMEDICINE_CLINIC, type TelemedicineClinic } from "./ports";
import {
  type MessageSender,
  telemedicineMessage,
  telemedicineSession,
  type TelemedicineMessageRecord,
  type TelemedicineSessionRecord,
} from "./telemedicine.schema";
import type { PatientContext } from "./telemedicine.service";

export const sendMessageSchema = z.object({ body: z.string().trim().min(1, "Write a message first").max(1000, "Keep a message under 1,000 characters") });
export class SendMessageDto extends createZodDto(sendMessageSchema) {}

export const messagesQuerySchema = z.object({
  /** The id of the last message already shown; only newer ones are returned. */
  after: z.string().uuid().optional(),
});
export class MessagesQueryDto extends createZodDto(messagesQuerySchema) {}

export interface ChatMessageView {
  id: string;
  sender: MessageSender;
  /** As shown to the other side when sent. */
  name: string;
  body: string;
  sentAt: Date;
}

export interface ChatView {
  messages: ChatMessageView[];
  /** Whether either side may write now (the patient is in the waiting room or the consultation is running). */
  open: boolean;
}

/** At most this many messages from one side in a minute: a chat, not a stream. */
const MESSAGES_PER_MINUTE = 20;
const PAGE = 200;

/**
 * Text chat during an online consultation — the fallback when video fails, and a way to share a number or a spelling. It
 * belongs to the consultation: open from the waiting room until the call ends, readable afterwards, never edited or removed
 * (append-only, migration 0125). It is plain text between the patient and the clinician; nothing in it is a clinical
 * instruction the platform acts on, and the documented record is still the encounter's note.
 */
@Injectable()
export class TelemedicineChatService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(TELEMEDICINE_CLINIC) private readonly clinic: TelemedicineClinic,
    private readonly audit: AuditService,
  ) {}

  // ---- staff ------------------------------------------------------------------------------

  async staffMessages(actor: Actor, appointmentId: string, after?: string): Promise<ChatView> {
    const appointment = await this.requireOnline(actor.organizationId, appointmentId);
    this.assertFacility(actor, appointment);
    return this.view(await this.sessionOf(appointment), after);
  }

  async staffSend(actor: Actor, appointmentId: string, body: string): Promise<ChatMessageView> {
    const appointment = await this.requireOnline(actor.organizationId, appointmentId);
    this.assertFacility(actor, appointment);
    const session = await this.sessionOf(appointment);
    return this.send(session, { sender: "staff", userId: actor.userId, name: actor.displayName }, body, (tx, row) =>
      this.audit.record(tx, actor, {
        action: "telemedicine.message-send",
        resourceType: "telemedicine_session",
        resourceId: row.sessionId,
        patientId: row.patientId,
      }),
    );
  }

  // ---- patient ----------------------------------------------------------------------------

  async patientMessages(patient: PatientContext, appointmentId: string, after?: string): Promise<ChatView> {
    const appointment = await this.requireOwn(patient, appointmentId);
    return this.view(await this.sessionOf(appointment), after);
  }

  async patientSend(patient: PatientContext, appointmentId: string, body: string): Promise<ChatMessageView> {
    const appointment = await this.requireOwn(patient, appointmentId);
    const session = await this.sessionOf(appointment);
    const name = (await this.clinic.patientDisplayName(patient.organizationId, patient.patientId)) ?? "Patient";
    return this.send(session, { sender: "patient", userId: null, name }, body, (tx, row) =>
      this.audit.record(tx, patient.audit, {
        action: "portal.teleconsult-message",
        resourceType: "telemedicine_session",
        resourceId: row.sessionId,
        patientId: patient.patientId,
      }),
    );
  }

  // ---- internals --------------------------------------------------------------------------

  private async send(
    session: TelemedicineSessionRecord | undefined,
    from: { sender: MessageSender; userId: string | null; name: string },
    body: string,
    audit: (tx: Parameters<Parameters<Database["transaction"]>[0]>[0], row: TelemedicineMessageRecord) => Promise<unknown>,
  ): Promise<ChatMessageView> {
    if (!session || !isOpen(session.status)) {
      throw new BusinessRuleError("The chat opens when the patient is in the waiting room and closes when the call ends", "chat_closed");
    }
    return this.db.transaction(async (tx) => {
      // One writer per consultation at a time, so the per-minute limit holds.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`tele-chat:${session.id}`}, 0))`);
      const [recent] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(telemedicineMessage)
        .where(
          and(
            eq(telemedicineMessage.sessionId, session.id),
            eq(telemedicineMessage.senderType, from.sender),
            gt(telemedicineMessage.createdAt, sql`now() - interval '1 minute'`),
          ),
        );
      if ((recent?.count ?? 0) >= MESSAGES_PER_MINUTE) {
        throw new BusinessRuleError("You are sending messages too fast; please wait a moment", "message_rate_limited");
      }
      const [row] = await tx
        .insert(telemedicineMessage)
        .values({
          organizationId: session.organizationId,
          sessionId: session.id,
          patientId: session.patientId,
          senderType: from.sender,
          senderUserId: from.userId,
          senderName: from.name,
          body,
        })
        .returning();
      await audit(tx, row!);
      return toView(row!);
    });
  }

  private async view(session: TelemedicineSessionRecord | undefined, after?: string): Promise<ChatView> {
    if (!session) return { messages: [], open: false };
    const filters = [eq(telemedicineMessage.sessionId, session.id)];
    // Keyset on (time, id) compared inside the database, so microsecond timestamps are never rounded on the way.
    if (after) {
      filters.push(
        sql`(${telemedicineMessage.createdAt}, ${telemedicineMessage.id}) > (SELECT m.created_at, m.id FROM telemedicine_message m WHERE m.id = ${after}::uuid AND m.session_id = ${session.id})`,
      );
    }
    const rows = await this.db
      .select()
      .from(telemedicineMessage)
      .where(and(...filters))
      .orderBy(asc(telemedicineMessage.createdAt), asc(telemedicineMessage.id))
      .limit(PAGE);
    return { messages: rows.map(toView), open: isOpen(session.status) };
  }

  private async sessionOf(appointment: OnlineAppointment): Promise<TelemedicineSessionRecord | undefined> {
    const [row] = await this.db.select().from(telemedicineSession).where(eq(telemedicineSession.appointmentId, appointment.id));
    return row;
  }

  private async requireOnline(organizationId: string, appointmentId: string): Promise<OnlineAppointment> {
    const appointment = await this.clinic.appointment(organizationId, appointmentId);
    if (!appointment || appointment.modality !== "telemedicine") throw new NotFoundError("Online consultation");
    return appointment;
  }

  private async requireOwn(patient: PatientContext, appointmentId: string): Promise<OnlineAppointment> {
    const appointment = await this.requireOnline(patient.organizationId, appointmentId);
    // The patient's own, or one filed under a record merged into theirs (ADR-0009).
    if (!(await isFiledAs(this.db, appointment.patientId, patient.patientId))) throw new NotFoundError("Online consultation");
    return appointment;
  }

  private assertFacility(actor: Actor, appointment: OnlineAppointment): void {
    if (requireFacilityId(actor) !== appointment.facilityId) throw new NotFoundError("Online consultation");
  }
}

/** The chat is open from the waiting room until the call ends. */
function isOpen(status: TelemedicineSessionRecord["status"]): boolean {
  return status === "waiting" || status === "in_consultation";
}

function toView(row: TelemedicineMessageRecord): ChatMessageView {
  return { id: row.id, sender: row.senderType, name: row.senderName, body: row.body, sentAt: row.createdAt };
}
