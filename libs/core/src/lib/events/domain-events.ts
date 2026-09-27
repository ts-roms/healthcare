import { Inject, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { and, asc, inArray, isNull, sql } from "drizzle-orm";
import { DATABASE, type Database, type DbExecutor } from "../database/database";
import { domainEvent, type DomainEventRecord } from "./domain-event.schema";

/**
 * A fact that happened in a domain (CLAUDE.md §26). Payloads carry
 * identifiers and codes, never clinical free text.
 */
export interface DomainEvent {
  type: string;
  organizationId: string;
  aggregateType: string;
  aggregateId: string;
  facilityId?: string | null;
  patientId?: string | null;
  payload?: Record<string, unknown>;
}

export type DomainEventHandler = (event: DomainEventRecord) => Promise<void>;

/** Writes events to the outbox inside the caller's transaction. */
@Injectable()
export class DomainEventPublisher {
  async record(executor: DbExecutor, ...events: DomainEvent[]): Promise<void> {
    if (events.length === 0) return;
    await executor.insert(domainEvent).values(
      events.map((event) => ({
        organizationId: event.organizationId,
        eventType: event.type,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        facilityId: event.facilityId ?? null,
        patientId: event.patientId ?? null,
        payload: event.payload ?? {},
      })),
    );
  }
}

/** In-process subscribers, registered by modules at start-up. */
@Injectable()
export class DomainEventHandlers {
  private readonly handlers = new Map<string, Array<{ name: string; handle: DomainEventHandler }>>();

  on(eventTypes: string | string[], name: string, handle: DomainEventHandler): void {
    for (const type of Array.isArray(eventTypes) ? eventTypes : [eventTypes]) {
      const list = this.handlers.get(type) ?? [];
      if (list.some((h) => h.name === name)) continue;
      list.push({ name, handle });
      this.handlers.set(type, list);
    }
  }

  for(eventType: string): ReadonlyArray<{ name: string; handle: DomainEventHandler }> {
    return this.handlers.get(eventType) ?? [];
  }
}

export const OUTBOX_MAX_ATTEMPTS = 10;
const BATCH_SIZE = 50;

/**
 * Dispatches outbox events to handlers, oldest first. At-least-once: a
 * failing handler causes the event to be retried (handlers must be
 * idempotent); after OUTBOX_MAX_ATTEMPTS it is parked as failed for review.
 * Rows are claimed with SKIP LOCKED so several API instances can run it.
 */
@Injectable()
export class OutboxRelay implements OnApplicationShutdown {
  private readonly logger = new Logger(OutboxRelay.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly handlers: DomainEventHandlers,
  ) {}

  start(intervalMs = 500): void {
    this.timer ??= setInterval(() => void this.tick(), intervalMs);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Processes pending events until none remain. Returns how many were dispatched. */
  async drain(): Promise<number> {
    let total = 0;
    for (;;) {
      const processed = await this.dispatchBatch();
      total += processed;
      if (processed < BATCH_SIZE) return total;
    }
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.drain();
    } catch (error) {
      this.logger.error(`Outbox relay failed: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }

  private async dispatchBatch(): Promise<number> {
    return this.db.transaction(async (tx) => {
      const events = await tx
        .select()
        .from(domainEvent)
        .where(and(isNull(domainEvent.publishedAt), isNull(domainEvent.failedAt)))
        .orderBy(asc(domainEvent.position))
        .limit(BATCH_SIZE)
        .for("update", { skipLocked: true });
      const published: string[] = [];
      for (const event of events) {
        const error = await this.dispatch(event);
        if (!error) {
          published.push(event.id);
          continue;
        }
        const attempts = event.attempts + 1;
        await tx
          .update(domainEvent)
          .set({ attempts, lastError: error.slice(0, 2000), failedAt: attempts >= OUTBOX_MAX_ATTEMPTS ? new Date() : null })
          .where(sql`${domainEvent.id} = ${event.id}`);
        this.logger.warn(`Event ${event.eventType} ${event.id} attempt ${attempts} failed: ${error}`);
      }
      if (published.length) await tx.update(domainEvent).set({ publishedAt: new Date() }).where(inArray(domainEvent.id, published));
      return events.length;
    });
  }

  private async dispatch(event: DomainEventRecord): Promise<string | undefined> {
    for (const handler of this.handlers.for(event.eventType)) {
      try {
        await handler.handle(event);
      } catch (error) {
        return `${handler.name}: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    return undefined;
  }
}
