import { Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { type OnGatewayConnection, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import { ActorResolver } from "@healthcare/auth";
import { PortalAccountService } from "@healthcare/patient";
import { type Actor, asPlatform, DomainEventHandlers, type DomainEventRecord } from "@healthcare/core";
import type { Namespace, Socket } from "socket.io";
import { LAB_REALTIME_EVENTS, labUpdate } from "./lab-updates";

export const REALTIME_NAMESPACE = "/realtime";

function facilityRoom(facilityId: string): string {
  return `facility:${facilityId}`;
}

/** Laboratory updates go only to sockets allowed to read the facility's laboratory orders. */
function laboratoryRoom(facilityId: string): string {
  return `laboratory:${facilityId}`;
}

/** Kiosk registration updates go only to sockets allowed to review them (they signal that the list changed; no detail). */
function registrationsRoom(facilityId: string): string {
  return `registrations:${facilityId}`;
}

/** A patient's own room: the conversation updates of their own MyHealth account, never anyone else's. */
function patientRoom(patientId: string): string {
  return `patient:${patientId}`;
}

/** How often every open socket is checked again (zero trust: access is verified for as long as the socket lives). */
export const REALTIME_REVALIDATE_MS = 60_000;

type Channel = "queue" | "display" | "laboratory" | "messages" | "registrations" | "notices";

/** Who a socket was opened for, kept on the socket so it can be checked again after its ticket expired. */
type SocketBinding =
  | { kind: "staff"; claims: { sub: string; sid: string; org: string }; facilityId: string; channels: Channel[] }
  | { kind: "patient"; claims: { sub: string; sid: string; org: string; pat: string } };

/** The channels a member's permissions at the facility allow (none: the socket is refused). */
function channelsFor(actor: Actor): Channel[] {
  return [
    ...(actor.permissions.has("clinic.queue.read") ? ["queue" as const] : []),
    // A waiting-room screen (display only): told that the queue changed, never which visit, its priority or status.
    ...(!actor.permissions.has("clinic.queue.read") && actor.permissions.has("clinic.queue.display") ? ["display" as const] : []),
    ...(actor.permissions.has("lab.order.read") ? ["laboratory" as const] : []),
    ...(actor.permissions.has("patient.message.read") ? ["messages" as const] : []),
    ...(actor.permissions.has("kiosk.registration.review") ? ["registrations" as const] : []),
    // Anyone who holds a permission at this facility hears their own notices; someone with none here is refused.
    ...(actor.permissions.size > 0 ? ["notices" as const] : []),
  ];
}

/** A staff member's own room: their notices, never anyone else's. */
function userRoom(userId: string): string {
  return `user:${userId}`;
}

/** Conversation updates go only to sockets allowed to read patients' MyHealth conversations. */
function messagesRoom(facilityId: string): string {
  return `messages:${facilityId}`;
}

/** The waiting-room screens of a facility: a separate room, so they never receive a visit's details. */
function displayRoom(facilityId: string): string {
  return `display:${facilityId}`;
}

function channelRoom(channel: Exclude<Channel, "notices">, facilityId: string): string {
  if (channel === "queue") return facilityRoom(facilityId);
  if (channel === "display") return displayRoom(facilityId);
  if (channel === "laboratory") return laboratoryRoom(facilityId);
  if (channel === "messages") return messagesRoom(facilityId);
  return registrationsRoom(facilityId);
}

/**
 * Realtime updates for display boards, the queue, laboratory worklists and patient conversations (CLAUDE.md §1).
 * Browsers connect with { auth: { ticket } } (a 60-second ticket from
 * POST /auth/realtime-tickets, bound to their session and facility); server
 * clients may use { auth: { token, facilityId } }. Either way the session and
 * account are checked on connect, and the socket joins the channels its permissions at that facility allow:
 * `queue.updated` with clinic.queue.read (the visit's id and status) or, for a waiting-room screen holding only
 * clinic.queue.display (migration 0112), in a room of its own with nothing but the time (it re-reads the display),
 * `lab.updated` with lab.order.read, `messages.updated` with patient.message.read, `registrations.updated` with
 * kiosk.registration.review (a kiosk registration arrived or was decided: the list refetches, nothing is sent about it), and `notices.updated` for every
 * staff member with any permission at the facility (their own in-app notices only, so the top bar's unread count
 * moves at once); a socket with no permission there is refused.
 * Messages carry ids and statuses only — clients refetch details through the authorized REST API.
 *
 * Every open socket is checked again every minute (revalidateAll): a session that ended, an account suspended or a
 * membership revoked disconnects it ("unauthorized"), and channels whose permission was removed are left.
 */
@WebSocketGateway({ namespace: REALTIME_NAMESPACE })
export class RealtimeGateway implements OnGatewayConnection, OnModuleInit, OnModuleDestroy {
  @WebSocketServer() server!: Namespace;
  private readonly logger = new Logger("Realtime");
  private revalidation?: NodeJS.Timeout;
  private revalidating = false;

  constructor(
    private readonly actors: ActorResolver,
    private readonly portal: PortalAccountService,
    private readonly handlers: DomainEventHandlers,
  ) {}

  onModuleInit(): void {
    this.handlers.on("QueueEntryUpdated", "realtime.queue", async (event) => this.broadcastQueue(event));
    this.handlers.on([...LAB_REALTIME_EVENTS], "realtime.laboratory", async (event) => this.broadcastLaboratory(event));
    this.handlers.on("PatientMessageSent", "realtime.messages", async (event) => this.broadcastMessages(event));
    this.handlers.on(["KioskRegistrationSubmitted", "KioskRegistrationDecided"], "realtime.registrations", async (event) => this.broadcastRegistrations(event));
    this.handlers.on("StaffNoticeCreated", "realtime.notices", async (event) => this.broadcastNotice(event));
    this.revalidation = setInterval(() => void this.revalidateAll(), REALTIME_REVALIDATE_MS);
    this.revalidation.unref();
  }

  onModuleDestroy(): void {
    if (this.revalidation) clearInterval(this.revalidation);
  }

  /**
   * Checks every socket open on this instance again, as a request would be checked: ended sessions and revoked access
   * disconnect; lost permissions leave their channels. Returns how many sockets were disconnected.
   */
  async revalidateAll(): Promise<number> {
    if (this.revalidating || !this.server) return 0;
    this.revalidating = true;
    let disconnected = 0;
    try {
      for (const socket of [...this.server.sockets.values()]) {
        const binding = socket.data["binding"] as SocketBinding | undefined;
        if (!binding) continue;
        const request = { ipAddress: socket.handshake.address, userAgent: socket.handshake.headers["user-agent"] };
        try {
          if (binding.kind === "patient") {
            await asPlatform("re-check a patient's realtime connection", () => this.portal.revalidateRealtime(binding.claims, request));
            continue;
          }
          const actor = await asPlatform("re-check a realtime connection", () => this.actors.revalidate(binding.claims, binding.facilityId, request));
          const allowed = channelsFor(actor);
          if (allowed.length === 0) throw new Error("Access to this facility has ended");
          for (const channel of binding.channels) {
            if (channel !== "notices" && !allowed.includes(channel)) await socket.leave(channelRoom(channel, binding.facilityId));
          }
          binding.channels = binding.channels.filter((channel) => allowed.includes(channel));
        } catch (error) {
          socket.emit("unauthorized", { message: error instanceof Error ? error.message : "Unauthorized" });
          socket.disconnect(true);
          disconnected += 1;
        }
      }
    } catch (error) {
      this.logger.error({ event: "realtime.revalidation_failed", message: String(error) });
    } finally {
      this.revalidating = false;
    }
    return disconnected;
  }

  async handleConnection(client: Socket): Promise<void> {
    const { ticket, token, facilityId, patientTicket } = (client.handshake.auth ?? {}) as {
      ticket?: unknown;
      token?: unknown;
      facilityId?: unknown;
      patientTicket?: unknown;
    };
    const request = { ipAddress: client.handshake.address, userAgent: client.handshake.headers["user-agent"] };
    if (typeof patientTicket === "string") return this.connectPatient(client, patientTicket, request);
    try {
      // The session is looked up before the organization is known (row-level security, migration 0111), as in the
      // access guard; a socket reads nothing else from the database.
      const actor = await asPlatform("resolve the realtime connection", async () => {
        if (typeof ticket === "string") {
          // Browsers: a short-lived ticket bound to the session and facility (POST /auth/realtime-tickets).
          return this.actors.resolveRealtimeTicket(ticket, request);
        }
        if (typeof token === "string" && typeof facilityId === "string") {
          // Server-side clients (e.g. display boards) may still use an access token.
          return this.actors.resolve(token, { facilityId }, request);
        }
        throw new Error("A ticket (or token and facilityId) is required");
      });
      const channels = channelsFor(actor);
      if (!actor.facilityId || channels.length === 0 || !actor.sessionId) throw new Error("Not permitted");
      for (const channel of channels) if (channel !== "notices") await client.join(channelRoom(channel, actor.facilityId));
      await client.join(userRoom(actor.userId));
      const binding: SocketBinding = {
        kind: "staff",
        claims: { sub: actor.userId, sid: actor.sessionId, org: actor.organizationId },
        facilityId: actor.facilityId,
        channels,
      };
      client.data["binding"] = binding;
      client.emit("ready", { facilityId: actor.facilityId, channels });
    } catch (error) {
      client.emit("unauthorized", { message: error instanceof Error ? error.message : "Unauthorized" });
      client.disconnect(true);
    }
  }

  /**
   * MyHealth: a patient's browser opens the socket with a ticket from `POST /portal/realtime-tickets`. The session, the
   * account and the portal consent are checked as for any portal request; the socket joins the patient's own room only and
   * hears that a conversation of theirs has a new message (`messages.updated`: thread id, no text).
   */
  private async connectPatient(client: Socket, ticket: string, request: { ipAddress?: string; userAgent?: string | string[] }): Promise<void> {
    try {
      const principal = await asPlatform("resolve the realtime connection of a patient", () =>
        this.portal.authenticateRealtimeTicket(ticket, {
          ipAddress: request.ipAddress,
          userAgent: Array.isArray(request.userAgent) ? request.userAgent[0] : request.userAgent,
        }),
      );
      await client.join(patientRoom(principal.patientId));
      const binding: SocketBinding = {
        kind: "patient",
        claims: { sub: principal.accountId, sid: principal.sessionId, org: principal.organizationId, pat: principal.patientId },
      };
      client.data["binding"] = binding;
      client.emit("ready", { channels: ["messages"] });
    } catch (error) {
      client.emit("unauthorized", { message: error instanceof Error ? error.message : "Unauthorized" });
      client.disconnect(true);
    }
  }

  private async broadcastQueue(event: DomainEventRecord): Promise<void> {
    if (!event.facilityId || !this.server) return;
    this.server.to(facilityRoom(event.facilityId)).emit("queue.updated", {
      visitId: event.aggregateId,
      occurredAt: event.occurredAt,
      ...event.payload,
    });
    // Waiting-room screens re-read GET /queue/display (tickets and places only); the message says only that it changed.
    this.server.to(displayRoom(event.facilityId)).emit("queue.updated", { occurredAt: event.occurredAt });
  }

  /** A kiosk registration arrived or was decided: reviewers' sockets refetch the list (no detail travels). */
  private async broadcastRegistrations(event: DomainEventRecord): Promise<void> {
    if (!event.facilityId || !this.server) return;
    this.server.to(registrationsRoom(event.facilityId)).emit("registrations.updated", { occurredAt: event.occurredAt });
  }

  /** A staff member got an in-app notice: only their own sockets hear it, and only that something new arrived. */
  private async broadcastNotice(event: DomainEventRecord): Promise<void> {
    const userId = event.payload["userId"];
    if (typeof userId !== "string" || !this.server) return;
    this.server.to(userRoom(userId)).emit("notices.updated", { occurredAt: event.occurredAt });
  }

  /** A message was sent in a conversation: ids and who sent it, never the text — the page re-reads through the REST API. */
  private async broadcastMessages(event: DomainEventRecord): Promise<void> {
    if (!event.facilityId || !this.server) return;
    const { threadId, messageId, sender } = event.payload as { threadId?: string; messageId?: string; sender?: string };
    this.server.to(messagesRoom(event.facilityId)).emit("messages.updated", { threadId, messageId, sender, occurredAt: event.occurredAt });
    // The patient hears the clinic's reply on their own open page (their own room; the thread id only).
    if (sender === "staff" && event.patientId)
      this.server.to(patientRoom(event.patientId)).emit("messages.updated", { threadId, occurredAt: event.occurredAt });
  }

  private async broadcastLaboratory(event: DomainEventRecord): Promise<void> {
    const update = labUpdate(event);
    if (!update || !event.facilityId || !this.server) return;
    this.server.to(laboratoryRoom(event.facilityId)).emit("lab.updated", update);
  }
}
