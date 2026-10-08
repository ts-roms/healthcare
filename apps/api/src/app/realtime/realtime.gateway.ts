import { type OnModuleInit } from "@nestjs/common";
import { type OnGatewayConnection, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import { ActorResolver } from "@healthcare/auth";
import { asPlatform, DomainEventHandlers, type DomainEventRecord } from "@healthcare/core";
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

/**
 * Realtime updates for display boards, the queue and laboratory worklists (CLAUDE.md §1).
 * Browsers connect with { auth: { ticket } } (a 60-second ticket from
 * POST /auth/realtime-tickets, bound to their session and facility); server
 * clients may use { auth: { token, facilityId } }. Either way the session and
 * account are checked on connect, and the socket joins the channels its permissions at that facility allow:
 * `queue.updated` with clinic.queue.read, `lab.updated` with lab.order.read (a socket with neither is refused).
 * Messages carry ids and statuses only — clients refetch details through the authorized REST API.
 */
@WebSocketGateway({ namespace: REALTIME_NAMESPACE })
export class RealtimeGateway implements OnGatewayConnection, OnModuleInit {
  @WebSocketServer() server!: Namespace;

  constructor(
    private readonly actors: ActorResolver,
    private readonly handlers: DomainEventHandlers,
  ) {}

  onModuleInit(): void {
    this.handlers.on("QueueEntryUpdated", "realtime.queue", async (event) => this.broadcastQueue(event));
    this.handlers.on([...LAB_REALTIME_EVENTS], "realtime.laboratory", async (event) => this.broadcastLaboratory(event));
  }

  async handleConnection(client: Socket): Promise<void> {
    const { ticket, token, facilityId } = (client.handshake.auth ?? {}) as { ticket?: unknown; token?: unknown; facilityId?: unknown };
    const request = { ipAddress: client.handshake.address, userAgent: client.handshake.headers["user-agent"] };
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
      const channels = [
        ...(actor.permissions.has("clinic.queue.read") ? ["queue" as const] : []),
        ...(actor.permissions.has("lab.order.read") ? ["laboratory" as const] : []),
      ];
      if (!actor.facilityId || channels.length === 0) throw new Error("Not permitted");
      if (channels.includes("queue")) await client.join(facilityRoom(actor.facilityId));
      if (channels.includes("laboratory")) await client.join(laboratoryRoom(actor.facilityId));
      client.emit("ready", { facilityId: actor.facilityId, channels });
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
  }

  private async broadcastLaboratory(event: DomainEventRecord): Promise<void> {
    const update = labUpdate(event);
    if (!update || !event.facilityId || !this.server) return;
    this.server.to(laboratoryRoom(event.facilityId)).emit("lab.updated", update);
  }
}
