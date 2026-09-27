import { type OnModuleInit } from "@nestjs/common";
import { type OnGatewayConnection, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import { ActorResolver } from "@healthcare/auth";
import { DomainEventHandlers, type DomainEventRecord } from "@healthcare/core";
import type { Namespace, Socket } from "socket.io";

export const REALTIME_NAMESPACE = "/realtime";

function facilityRoom(facilityId: string): string {
  return `facility:${facilityId}`;
}

/**
 * Realtime queue updates for display boards and worklists (CLAUDE.md §1).
 * Browsers connect with { auth: { ticket } } (a 60-second ticket from
 * POST /auth/realtime-tickets, bound to their session and facility); server
 * clients may use { auth: { token, facilityId } }. Either way the session,
 * account and clinic.queue.read at that facility are checked on connect. Messages carry ids and statuses only —
 * clients refetch details through the authorized REST API.
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
  }

  async handleConnection(client: Socket): Promise<void> {
    const { ticket, token, facilityId } = (client.handshake.auth ?? {}) as { ticket?: unknown; token?: unknown; facilityId?: unknown };
    const request = { ipAddress: client.handshake.address, userAgent: client.handshake.headers["user-agent"] };
    try {
      let actor;
      if (typeof ticket === "string") {
        // Browsers: a short-lived ticket bound to the session and facility (POST /auth/realtime-tickets).
        actor = await this.actors.resolveRealtimeTicket(ticket, request);
      } else if (typeof token === "string" && typeof facilityId === "string") {
        // Server-side clients (e.g. display boards) may still use an access token.
        actor = await this.actors.resolve(token, { facilityId }, request);
      } else {
        throw new Error("A ticket (or token and facilityId) is required");
      }
      if (!actor.facilityId || !actor.permissions.has("clinic.queue.read")) throw new Error("Not permitted");
      await client.join(facilityRoom(actor.facilityId));
      client.emit("ready", { facilityId: actor.facilityId });
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
}
