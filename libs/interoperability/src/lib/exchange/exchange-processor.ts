import { Inject, Injectable, Logger } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  APP_CONFIG,
  type AppConfig,
  DATABASE,
  type Database,
  decryptSecret,
  DomainEventPublisher,
  integrationPayloadKey,
  sha256Hex,
  systemActor,
} from "@healthcare/core";
import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import { integrationExchange, integrationExchangePayload, type IntegrationExchangeRecord } from "./exchange.schema";
import { EXCHANGE_HANDLERS, type ExchangeCompletedPayload, type ExchangeHandler, type ExchangeOutcome, INTEGRATION_EXCHANGE_COMPLETED } from "./exchange-types";

/** Thrown for a transient failure the queue should retry (with backoff). */
export class RetryableExchangeError extends Error {}

/** A job that has not started this long after the request, or stalled this long, is re-enqueued. */
const STRANDED_AFTER_MINUTES = 10;
const STALLED_AFTER_MINUTES = 30;

type FinalStatus = ExchangeCompletedPayload["status"];

/**
 * Worker side: sends a queued exchange through its handler and records the outcome. Idempotent — an exchange that is
 * no longer queued is left alone. The sealed payload is decrypted and checked against the digest recorded at request
 * time, and deleted once the exchange is final. Final outcomes are published (outbox) for the API to act on.
 */
@Injectable()
export class IntegrationExchangeProcessor {
  private readonly logger = new Logger(IntegrationExchangeProcessor.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(EXCHANGE_HANDLERS) private readonly handlers: ExchangeHandler[],
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
  ) {}

  async process(exchangeId: string, options: { finalAttempt: boolean } = { finalAttempt: true }): Promise<FinalStatus | "skipped" | "retry"> {
    const [exchange] = await this.db.select().from(integrationExchange).where(eq(integrationExchange.id, exchangeId));
    if (!exchange || exchange.status !== "queued") return "skipped";
    await this.db.update(integrationExchange).set({ lastAttemptAt: new Date() }).where(eq(integrationExchange.id, exchangeId));

    const handler = this.handlers.find((h) => h.system === exchange.system && h.operation === exchange.operation);
    if (!handler) return this.finish(exchange, "not_configured", { lastError: `No adapter for ${exchange.system} ${exchange.operation}` });

    let payload: unknown;
    try {
      payload = await this.open(exchange);
    } catch (error) {
      return this.finish(exchange, "failed", { lastError: `Payload unusable: ${(error as Error).message}` });
    }

    let result: ExchangeOutcome;
    try {
      result = await handler.send(payload, exchange.idempotencyKey);
    } catch (error) {
      // An adapter that throws is treated as a transient failure.
      result = { outcome: "failed", retryable: true, error: (error as Error).message };
    }
    switch (result.outcome) {
      case "accepted":
        return this.finish(exchange, "accepted", {
          externalReference: result.externalReference,
          outcomeDetail: result.detail ? { detail: result.detail } : undefined,
        });
      case "rejected":
        return this.finish(exchange, "rejected", { outcomeDetail: { reasons: result.reasons } });
      case "not_configured":
        return this.finish(exchange, "not_configured", {});
      case "failed": {
        if (!result.retryable || options.finalAttempt) return this.finish(exchange, "failed", { lastError: result.error });
        await this.db
          .update(integrationExchange)
          .set({ attempts: sql`${integrationExchange.attempts} + 1`, lastError: result.error.slice(0, 2000) })
          .where(and(eq(integrationExchange.id, exchange.id), eq(integrationExchange.status, "queued")));
        throw new RetryableExchangeError(`${exchange.system} ${exchange.operation} failed: ${result.error}`);
      }
    }
  }

  /** Queued exchanges whose job never started or stalled (e.g. Redis lost it); the caller re-enqueues them. */
  async findStranded(now = new Date()): Promise<string[]> {
    const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
    const rows = await this.db
      .select({ id: integrationExchange.id })
      .from(integrationExchange)
      .where(
        and(
          eq(integrationExchange.status, "queued"),
          or(
            and(isNull(integrationExchange.lastAttemptAt), lte(integrationExchange.requestedAt, minutesAgo(STRANDED_AFTER_MINUTES))),
            lte(integrationExchange.lastAttemptAt, minutesAgo(STALLED_AFTER_MINUTES)),
          ),
        ),
      )
      .limit(500);
    return rows.map((r) => r.id);
  }

  private async open(exchange: IntegrationExchangeRecord): Promise<unknown> {
    const [sealed] = await this.db.select().from(integrationExchangePayload).where(eq(integrationExchangePayload.exchangeId, exchange.id));
    if (!sealed) throw new Error("payload missing");
    const plaintext = decryptSecret(sealed.ciphertext, integrationPayloadKey(this.config));
    if (sha256Hex(plaintext) !== exchange.payloadDigest) throw new Error("payload does not match the digest recorded at request");
    return JSON.parse(plaintext) as unknown;
  }

  private async finish(
    exchange: IntegrationExchangeRecord,
    status: FinalStatus,
    fields: { externalReference?: string; outcomeDetail?: Record<string, unknown>; lastError?: string },
  ): Promise<FinalStatus | "skipped"> {
    const done = await this.db.transaction(async (tx) => {
      const updated = await tx
        .update(integrationExchange)
        .set({
          status,
          attempts: sql`${integrationExchange.attempts} + 1`,
          externalReference: fields.externalReference ?? null,
          outcomeDetail: fields.outcomeDetail ?? {},
          lastError: fields.lastError?.slice(0, 2000) ?? null,
          completedAt: new Date(),
        })
        .where(and(eq(integrationExchange.id, exchange.id), eq(integrationExchange.status, "queued")))
        .returning({ id: integrationExchange.id });
      if (updated.length === 0) return false;
      // The PHI payload is not kept once the exchange is final.
      await tx.delete(integrationExchangePayload).where(eq(integrationExchangePayload.exchangeId, exchange.id));
      await this.audit.record(tx, systemActor(exchange.organizationId, null, exchange.system), {
        action: "integration.exchange.completed",
        resourceType: exchange.resourceType,
        resourceId: exchange.resourceId,
        patientId: exchange.patientId ?? undefined,
        outcome: status === "accepted" ? "success" : "failure",
        metadata: {
          exchangeId: exchange.id,
          system: exchange.system,
          operation: exchange.operation,
          status,
          externalReference: fields.externalReference ?? null,
        },
      });
      const payload: ExchangeCompletedPayload = {
        exchangeId: exchange.id,
        system: exchange.system,
        operation: exchange.operation,
        status,
        resourceType: exchange.resourceType,
        resourceId: exchange.resourceId,
        externalReference: fields.externalReference ?? null,
        detail: (fields.outcomeDetail?.detail as Record<string, string> | undefined) ?? {},
        requestedBy: exchange.requestedBy,
      };
      await this.events.record(tx, {
        type: INTEGRATION_EXCHANGE_COMPLETED,
        organizationId: exchange.organizationId,
        aggregateType: "integration_exchange",
        aggregateId: exchange.id,
        patientId: exchange.patientId,
        payload: { ...payload },
      });
      return true;
    });
    if (!done) return "skipped";
    if (status !== "accepted")
      this.logger.warn(`Exchange ${exchange.id} (${exchange.system} ${exchange.operation}) ${status}${fields.lastError ? `: ${fields.lastError}` : ""}`);
    return status;
  }
}
