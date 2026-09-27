import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { type Actor, BusinessRuleError, DATABASE, type Database, NotFoundError } from "@healthcare/core";
import { and, desc, eq, inArray, isNotNull, isNull, lte, or, type SQL, sql } from "drizzle-orm";
import type { z } from "zod";
import { integrationExchange, integrationExchangePayload, type IntegrationExchangeRecord } from "./exchange.schema";
import { STALLED_AFTER_MINUTES, STRANDED_AFTER_MINUTES } from "./exchange-processor";
import { EXCHANGE_PATIENTS, type ExchangePatientDirectory, INTEGRATION_QUEUE, type IntegrationQueue } from "./exchange-types";
import type { listExchangesSchema } from "./exchange-review.dto";

const UNSUCCESSFUL = ["failed", "rejected", "not_configured"] as const;

/**
 * Operator review of outbound exchanges (API side): what failed, was rejected or
 * could not be sent, and what looks stalled in the queue. Staff fix the cause and
 * prepare the request again from its source (invoice, case report, patient record),
 * re-queue a stalled exchange, or record a resolution. Payloads are never shown.
 */
@Injectable()
export class ExchangeReviewService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(INTEGRATION_QUEUE) private readonly queue: IntegrationQueue,
    @Inject(EXCHANGE_PATIENTS) private readonly patients: ExchangePatientDirectory,
    private readonly audit: AuditService,
  ) {}

  async list(actor: Actor, query: z.infer<typeof listExchangesSchema>, now = new Date()) {
    const conditions: SQL[] = [eq(integrationExchange.organizationId, actor.organizationId)];
    if (query.view === "attention") conditions.push(or(this.needsReview(), this.stalled(now))!);
    if (query.status) conditions.push(eq(integrationExchange.status, query.status));
    if (query.system) conditions.push(eq(integrationExchange.system, query.system));
    const rows = await this.db
      .select({ exchange: integrationExchange, sealed: isNotNull(integrationExchangePayload.exchangeId).mapWith(Boolean) })
      .from(integrationExchange)
      .leftJoin(integrationExchangePayload, eq(integrationExchangePayload.exchangeId, integrationExchange.id))
      .where(and(...conditions))
      .orderBy(desc(integrationExchange.requestedAt))
      .limit(200);
    const briefs = await this.patients.briefs(actor.organizationId, [...new Set(rows.map((r) => r.exchange.patientId).filter((id): id is string => !!id))]);
    await this.audit.recordStandalone(actor, {
      action: "integration.exchange.list",
      resourceType: "integration_exchange",
      metadata: { view: query.view, status: query.status ?? null, system: query.system ?? null, count: rows.length },
    });
    return {
      summary: await this.summary(actor.organizationId, now),
      exchanges: rows.map((r) => view(r.exchange, r.sealed, now, r.exchange.patientId ? (briefs.get(r.exchange.patientId) ?? null) : null)),
    };
  }

  /** Counts for the admin screen and navigation. */
  async summary(organizationId: string, now = new Date()) {
    const [row] = await this.db
      .select({
        needsReview: sql<number>`count(*) FILTER (WHERE ${this.needsReview()})`.mapWith(Number),
        stalled: sql<number>`count(*) FILTER (WHERE ${this.stalled(now)})`.mapWith(Number),
        queued: sql<number>`count(*) FILTER (WHERE ${integrationExchange.status} = 'queued')`.mapWith(Number),
      })
      .from(integrationExchange)
      .where(eq(integrationExchange.organizationId, organizationId));
    return row ?? { needsReview: 0, stalled: 0, queued: 0 };
  }

  /** Puts a queued exchange back on the worker's queue (e.g. its job was lost). Harmless if a job exists (deduped by id). */
  async requeue(actor: Actor, exchangeId: string) {
    const exchange = await this.find(actor.organizationId, exchangeId);
    if (exchange.status !== "queued")
      throw new BusinessRuleError(`The exchange is ${exchange.status.replace("_", " ")}; only queued exchanges can be re-queued`, "exchange_not_queued");
    const [sealed] = await this.db
      .select({ id: integrationExchangePayload.exchangeId })
      .from(integrationExchangePayload)
      .where(eq(integrationExchangePayload.exchangeId, exchangeId));
    if (!sealed) throw new BusinessRuleError("The prepared payload is gone; prepare the request again from its source", "payload_missing");
    await this.queue.enqueue(exchangeId);
    await this.audit.recordStandalone(actor, {
      action: "integration.exchange.requeue",
      resourceType: "integration_exchange",
      resourceId: exchangeId,
      patientId: exchange.patientId ?? undefined,
      metadata: { system: exchange.system, operation: exchange.operation },
    });
    return this.detail(actor.organizationId, exchangeId);
  }

  /** Records that an unsuccessful exchange was reviewed and needs nothing more (the outcome itself never changes). */
  async resolve(actor: Actor, exchangeId: string, note: string) {
    await this.db.transaction(async (tx) => {
      const [exchange] = await tx
        .select()
        .from(integrationExchange)
        .where(and(eq(integrationExchange.organizationId, actor.organizationId), eq(integrationExchange.id, exchangeId)))
        .for("update");
      if (!exchange) throw new NotFoundError("Exchange");
      if (!(UNSUCCESSFUL as readonly string[]).includes(exchange.status)) {
        throw new BusinessRuleError("Only failed, rejected or unsent exchanges are resolved", "exchange_not_unsuccessful");
      }
      if (exchange.resolvedAt) throw new BusinessRuleError("The exchange was already resolved", "exchange_resolved");
      await tx
        .update(integrationExchange)
        .set({ resolvedAt: new Date(), resolvedBy: actor.userId, resolutionNote: note })
        .where(eq(integrationExchange.id, exchangeId));
      await this.audit.record(tx, actor, {
        action: "integration.exchange.resolve",
        resourceType: "integration_exchange",
        resourceId: exchangeId,
        patientId: exchange.patientId ?? undefined,
        reason: note,
        metadata: { system: exchange.system, operation: exchange.operation, status: exchange.status },
      });
    });
    return this.detail(actor.organizationId, exchangeId);
  }

  private async detail(organizationId: string, exchangeId: string, now = new Date()) {
    const exchange = await this.find(organizationId, exchangeId);
    const [sealed] = await this.db
      .select({ id: integrationExchangePayload.exchangeId })
      .from(integrationExchangePayload)
      .where(eq(integrationExchangePayload.exchangeId, exchangeId));
    const briefs = exchange.patientId ? await this.patients.briefs(organizationId, [exchange.patientId]) : new Map();
    return view(exchange, !!sealed, now, exchange.patientId ? (briefs.get(exchange.patientId) ?? null) : null);
  }

  private async find(organizationId: string, exchangeId: string): Promise<IntegrationExchangeRecord> {
    const [row] = await this.db
      .select()
      .from(integrationExchange)
      .where(and(eq(integrationExchange.organizationId, organizationId), eq(integrationExchange.id, exchangeId)));
    if (!row) throw new NotFoundError("Exchange");
    return row;
  }

  private needsReview(): SQL {
    return and(inArray(integrationExchange.status, [...UNSUCCESSFUL]), isNull(integrationExchange.resolvedAt))!;
  }

  private stalled(now: Date): SQL {
    return and(
      eq(integrationExchange.status, "queued"),
      or(
        and(isNull(integrationExchange.lastAttemptAt), lte(integrationExchange.requestedAt, minutesBefore(now, STRANDED_AFTER_MINUTES))),
        lte(integrationExchange.lastAttemptAt, minutesBefore(now, STALLED_AFTER_MINUTES)),
      ),
    )!;
  }
}

function minutesBefore(now: Date, minutes: number): Date {
  return new Date(now.getTime() - minutes * 60_000);
}

function isStalled(row: IntegrationExchangeRecord, now: Date): boolean {
  if (row.status !== "queued") return false;
  if (!row.lastAttemptAt) return row.requestedAt <= minutesBefore(now, STRANDED_AFTER_MINUTES);
  return row.lastAttemptAt <= minutesBefore(now, STALLED_AFTER_MINUTES);
}

function view(row: IntegrationExchangeRecord, payloadSealed: boolean, now: Date, patient: { patientNumber: string; displayName: string } | null) {
  return {
    id: row.id,
    system: row.system,
    operation: row.operation,
    status: row.status,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    patientId: row.patientId,
    patient,
    attempts: row.attempts,
    externalReference: row.externalReference,
    outcomeDetail: row.outcomeDetail,
    lastError: row.lastError,
    payloadDigest: row.payloadDigest,
    /** The encrypted payload is still held for the worker (only while queued). */
    payloadSealed,
    stalled: isStalled(row, now),
    requestedBy: row.requestedBy,
    requestedAt: row.requestedAt.toISOString(),
    lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolvedBy: row.resolvedBy,
    resolutionNote: row.resolutionNote,
  };
}
