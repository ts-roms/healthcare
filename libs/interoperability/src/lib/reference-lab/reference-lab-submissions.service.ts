import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { type Actor, BusinessRuleError, ConflictError, DATABASE, type Database, NotFoundError } from "@healthcare/core";
import { and, desc, eq } from "drizzle-orm";
import { integrationExchange, type IntegrationExchangeRecord } from "../exchange/exchange.schema";
import type { ExchangeCompletedPayload } from "../exchange/exchange-types";
import { IntegrationExchanges } from "../exchange/integration-exchanges.service";
import { REFERENCE_LAB_GATEWAY, REFERENCE_LAB_SYSTEM, type ReferenceLabGateway, SUBMIT_SEND_OUT } from "./gateway";
import { REFERENCE_LAB_SINK, REFERENCE_LAB_SOURCES, type ReferenceLabSink, type ReferenceLabSources } from "./ports";
import { buildSendOutPackage, sendOutIsReady, sendOutReadiness } from "./send-out-package";

const RESOURCE_TYPE = "lab_send_out_dispatch";

/**
 * Electronic submission of a send-out dispatch to its reference laboratory (API side). The default gateway is
 * unconfigured — no reference laboratory interface is on record — so a submission is refused rather than faked, and
 * specimens travel with the printed manifest. With an adapter, the package is sealed here and sent by the integration
 * worker; an acknowledgement is recorded on the dispatch (docs/interoperability/reference-laboratories.md).
 */
@Injectable()
export class ReferenceLabSubmissions {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(REFERENCE_LAB_GATEWAY) private readonly gateway: ReferenceLabGateway,
    @Inject(REFERENCE_LAB_SOURCES) private readonly sources: ReferenceLabSources,
    @Inject(REFERENCE_LAB_SINK) private readonly sink: ReferenceLabSink,
    private readonly exchanges: IntegrationExchanges,
    private readonly audit: AuditService,
  ) {}

  integration() {
    return this.gateway.specification;
  }

  /** The integration's status, readiness of the platform's data for this dispatch, and earlier submissions. */
  async status(actor: Actor, dispatchId: string) {
    const src = await this.sources.forDispatch(actor.organizationId, dispatchId);
    if (!src) throw new NotFoundError("Dispatch");
    const checks = sendOutReadiness(src);
    return {
      integration: this.gateway.specification,
      dispatchId,
      ready: sendOutIsReady(checks),
      checks,
      submissions: await this.submissions(actor.organizationId, dispatchId),
    };
  }

  /**
   * Queues the dispatch for the integration worker. Refused while the interface is an integration dependency, while the
   * data is incomplete, and while an earlier submission is queued or was accepted. The same idempotency key returns the
   * same exchange.
   */
  async submit(actor: Actor, dispatchId: string, idempotencyKey: string) {
    if (this.gateway.specification.status === "dependency") {
      throw new BusinessRuleError(
        "No electronic interface to this reference laboratory is configured: its specification is an integration dependency. Send the specimens with the printed manifest.",
        "integration_not_configured",
      );
    }
    const [existing] = await this.db
      .select()
      .from(integrationExchange)
      .where(
        and(
          eq(integrationExchange.organizationId, actor.organizationId),
          eq(integrationExchange.system, REFERENCE_LAB_SYSTEM),
          eq(integrationExchange.idempotencyKey, idempotencyKey),
        ),
      );
    if (existing) {
      if (existing.resourceId !== dispatchId)
        throw new ConflictError("This idempotency key was used for another dispatch", undefined, "idempotency_key_reused");
      return this.status(actor, dispatchId);
    }
    const src = await this.sources.forDispatch(actor.organizationId, dispatchId);
    if (!src) throw new NotFoundError("Dispatch");
    const checks = sendOutReadiness(src);
    if (!sendOutIsReady(checks)) {
      throw new BusinessRuleError(
        "The dispatch cannot be sent electronically",
        "send_out_not_ready",
        checks.filter((c) => !c.ok),
      );
    }
    const earlier = await this.submissions(actor.organizationId, dispatchId);
    if (earlier.some((s) => s.status === "queued" || s.status === "accepted")) {
      throw new BusinessRuleError("This dispatch was already submitted", "already_submitted");
    }
    const patientIds = [...new Set(src.patientIds)];
    await this.db.transaction(async (tx) => {
      const exchange = await this.exchanges.request(tx, actor, {
        system: REFERENCE_LAB_SYSTEM,
        operation: SUBMIT_SEND_OUT,
        idempotencyKey,
        // A dispatch may carry several patients; the audit below records each one.
        patientId: patientIds.length === 1 ? (patientIds[0] ?? null) : null,
        resourceType: RESOURCE_TYPE,
        resourceId: dispatchId,
        facilityId: src.sendingFacility.id,
        payload: buildSendOutPackage(src),
      });
      for (const patientId of patientIds) {
        await this.audit.record(tx, actor, {
          action: "lab.send-out.submit-request",
          resourceType: RESOURCE_TYPE,
          resourceId: dispatchId,
          patientId,
          metadata: { exchangeId: exchange.id, manifestNumber: src.dispatch.manifestNumber, referenceLaboratoryId: src.referenceLaboratory.id },
        });
      }
    });
    return this.status(actor, dispatchId);
  }

  /** Outbox handler (IntegrationExchangeCompleted): an accepted submission is recorded on the dispatch. Idempotent. */
  async exchangeCompleted(organizationId: string, outcome: ExchangeCompletedPayload): Promise<void> {
    if (outcome.system !== REFERENCE_LAB_SYSTEM || outcome.operation !== SUBMIT_SEND_OUT) return;
    if (outcome.status !== "accepted" || !outcome.externalReference) return;
    await this.sink.dispatchAcknowledged({
      organizationId,
      dispatchId: outcome.resourceId,
      reference: outcome.externalReference,
      exchangeId: outcome.exchangeId,
    });
  }

  private async submissions(organizationId: string, dispatchId: string) {
    const rows: IntegrationExchangeRecord[] = await this.db
      .select()
      .from(integrationExchange)
      .where(
        and(
          eq(integrationExchange.organizationId, organizationId),
          eq(integrationExchange.system, REFERENCE_LAB_SYSTEM),
          eq(integrationExchange.resourceType, RESOURCE_TYPE),
          eq(integrationExchange.resourceId, dispatchId),
        ),
      )
      .orderBy(desc(integrationExchange.requestedAt));
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      attempts: r.attempts,
      externalReference: r.externalReference,
      outcomeDetail: r.outcomeDetail,
      lastError: r.lastError,
      requestedAt: r.requestedAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
    }));
  }
}
