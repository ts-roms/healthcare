import { type OnModuleInit } from '@nestjs/common';
import { type OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { ActorResolver } from '@healthcare/auth';
import { DomainEventHandlers, type DomainEventRecord } from '@healthcare/core';
import type { Namespace, Socket } from 'socket.io';

export const REALTIME_NAMESPACE = '/realtime';

function facilityRoom(facilityId: string): string {
  return `facility:${facilityId}`;
}

/**
 * Realtime queue updates for display boards and worklists (CLAUDE.md §1).
 * Clients connect with { auth: { token, facilityId } }; they must hold
 * clinic.queue.read at that facility. Messages carry ids and statuses only —
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
    this.handlers.on('QueueEntryUpdated', 'realtime.queue', async (event) => this.broadcastQueue(event));
  }

  async handleConnection(client: Socket): Promise<void> {
    const { token, facilityId } = (client.handshake.auth ?? {}) as { token?: unknown; facilityId?: unknown };
    try {
      if (typeof token !== 'string' || typeof facilityId !== 'string') throw new Error('token and facilityId are required');
      const actor = await this.actors.resolve(token, { facilityId }, { ipAddress: client.handshake.address, userAgent: client.handshake.headers['user-agent'] });
      if (!actor.permissions.has('clinic.queue.read')) throw new Error('Not permitted');
      await client.join(facilityRoom(facilityId));
      client.emit('ready', { facilityId });
    } catch (error) {
      client.emit('unauthorized', { message: error instanceof Error ? error.message : 'Unauthorized' });
      client.disconnect(true);
    }
  }

  private async broadcastQueue(event: DomainEventRecord): Promise<void> {
    if (!event.facilityId || !this.server) return;
    this.server.to(facilityRoom(event.facilityId)).emit('queue.updated', {
      visitId: event.aggregateId,
      occurredAt: event.occurredAt,
      ...event.payload,
    });
  }
}

