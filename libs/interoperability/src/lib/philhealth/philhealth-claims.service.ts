import { Inject, Injectable, Logger } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { type Actor, BusinessRuleError, ConflictError, DATABASE, type Database, DomainEventPublisher, NotFoundError, systemActor } from "@healthcare/core";
import { and, desc, eq, inArray } from "drizzle-orm";
import { type AccreditationSource, buildClaimPackage, claimReadiness, type ClaimSources, isReady, maskPin, packageDigest } from "./claim-package";
import { PHILHEALTH_CLAIMS_GATEWAY, PHILHEALTH_ECLAIMS_SYSTEM, type PhilHealthClaimsGateway } from "./gateway";
import { integrationExchange, type IntegrationExchangeRecord } from "./philhealth.schema";
import { PhilHealthSettingsService } from "./philhealth-settings.service";
import { PHILHEALTH_BILLING_SINK, PHILHEALTH_CLAIM_SOURCES, type PhilHealthBillingSink, type PhilHealthClaimSources } from "./ports";

export const CLAIM_SUBMISSION_REQUESTED = "PhilHealthClaimSubmissionRequested";
const OPERATION = "submit_claim";
/** Transient adapter failures are retried by the outbox this many times before the exchange is marked failed. */
export const MAX_SUBMISSION_ATTEMPTS = 5;

/**
 * Prepares PhilHealth claims from issued invoices and hands them to the
 * configured gateway. The default gateway is unconfigured (no official eClaims
 * specification on record): claims can be prepared and checked, but a
 * submission is refused rather than faked. Every exchange is logged with an
 * idempotency key and a digest of what was prepared — never the PHI payload.
 */
@Injectable()
export class PhilHealthClaimsService {
  private readonly logger = new Logger(PhilHealthClaimsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(PHILHEALTH_CLAIMS_GATEWAY) private readonly gateway: PhilHealthClaimsGateway,
    @Inject(PHILHEALTH_CLAIM_SOURCES) private readonly sources: PhilHealthClaimSources,
    @Inject(PHILHEALTH_BILLING_SINK) private readonly billing: PhilHealthBillingSink,
    private readonly settings: PhilHealthSettingsService,
    private readonly events: DomainEventPublisher,
    private readonly audit: AuditService,
  ) {}

  integration() {
    return this.gateway.specification;
  }

  /** The claim as it would be prepared now: readiness checks, the package (PIN masked) and earlier submissions. */
  async preview(actor: Actor, invoiceId: string) {
    const { src, accreditation } = await this.load(actor.organizationId, invoiceId);
    const checks = claimReadiness(src, accreditation);
    const ready = isReady(checks);
    const claim = ready ? buildClaimPackage(src, accreditation) : null;
    await this.audit.recordStandalone(actor, {
      action: "philhealth.claim.preview",
      resourceType: "billing_invoice",
      resourceId: invoiceId,
      patientId: src.invoice.patientId,
      metadata: { ready },
    });
    return {
      integration: this.gateway.specification,
      invoiceId,
      ready,
      checks,
      claim: claim ? { ...claim, patient: { ...claim.patient, philhealthPin: maskPin(claim.patient.philhealthPin) } } : null,
      submissions: await this.submissions(actor.organizationId, invoiceId),
    };
  }

  /**
   * Queues a submission (processed from the outbox, at-least-once). Refused while the eClaims specification is an
   * integration dependency, while the platform data is incomplete, and while an earlier submission is pending or
   * was accepted. The same idempotency key returns the same exchange.
   */
  async requestSubmission(actor: Actor, invoiceId: string, idempotencyKey: string) {
    if (this.gateway.specification.status === "dependency") {
      throw new BusinessRuleError(
        "PhilHealth eClaims is not connected: the official specification is an integration dependency. Submit through PhilHealth's own channel and record the claim reference on the invoice.",
        "integration_not_configured",
      );
    }
    const existing = await this.findByKey(actor.organizationId, idempotencyKey);
    if (existing) {
      if (existing.resourceId !== invoiceId) throw new ConflictError("This idempotency key was used for another claim", undefined, "idempotency_key_reused");
      return exchangeView(existing);
    }
    const { src, accreditation } = await this.load(actor.organizationId, invoiceId);
    const checks = claimReadiness(src, accreditation);
    if (!isReady(checks)) {
      throw new BusinessRuleError(
        "The claim cannot be prepared yet",
        "claim_not_ready",
        checks.filter((c) => !c.ok),
      );
    }
    const claim = buildClaimPackage(src, accreditation);
    const created = await this.db.transaction(async (tx) => {
      // One claim in flight or accepted per invoice; serialise concurrent requests on the invoice.
      const open = await tx
        .select({ id: integrationExchange.id, status: integrationExchange.status })
        .from(integrationExchange)
        .where(
          and(
            eq(integrationExchange.organizationId, actor.organizationId),
            eq(integrationExchange.system, PHILHEALTH_ECLAIMS_SYSTEM),
            eq(integrationExchange.resourceType, "billing_invoice"),
            eq(integrationExchange.resourceId, invoiceId),
            inArray(integrationExchange.status, ["queued", "accepted"]),
          ),
        )
        .for("update");
      if (open.length > 0) {
        throw new ConflictError(
          open.some((o) => o.status === "accepted")
            ? "PhilHealth already acknowledged a claim for this invoice"
            : "A submission for this invoice is in progress",
          undefined,
          "claim_already_submitted",
        );
      }
      const [row] = (await tx
        .insert(integrationExchange)
        .values({
          organizationId: actor.organizationId,
          system: PHILHEALTH_ECLAIMS_SYSTEM,
          operation: OPERATION,
          idempotencyKey,
          patientId: src.invoice.patientId,
          resourceType: "billing_invoice",
          resourceId: invoiceId,
          payloadDigest: packageDigest(claim),
          requestedBy: actor.userId,
        })
        .returning()) as [IntegrationExchangeRecord];
      await this.audit.record(tx, actor, {
        action: "philhealth.claim.submit-request",
        resourceType: "billing_invoice",
        resourceId: invoiceId,
        patientId: src.invoice.patientId,
        metadata: { exchangeId: row.id, amountClaimed: claim.coverage.amountClaimed },
      });
      await this.events.record(tx, {
        type: CLAIM_SUBMISSION_REQUESTED,
        organizationId: actor.organizationId,
        aggregateType: "integration_exchange",
        aggregateId: row.id,
        facilityId: src.invoice.facilityId,
        patientId: src.invoice.patientId,
        payload: { invoiceId },
      });
      return row;
    });
    return exchangeView(created);
  }

  /**
   * Outbox handler: sends a queued claim through the gateway and records the outcome. Idempotent — an exchange that
   * is no longer queued is left alone; the gateway receives the exchange's idempotency key.
   */
  async process(organizationId: string, exchangeId: string): Promise<void> {
    const [exchange] = await this.db
      .select()
      .from(integrationExchange)
      .where(and(eq(integrationExchange.organizationId, organizationId), eq(integrationExchange.id, exchangeId)));
    if (!exchange || exchange.status !== "queued") return;

    // Rebuild from current data: an issued invoice cannot change, but the patient's details can.
    const { src, accreditation } = await this.load(organizationId, exchange.resourceId);
    const checks = claimReadiness(src, accreditation);
    if (!isReady(checks))
      return this.finish(exchange, "failed", {
        lastError: `Not ready: ${checks
          .filter((c) => !c.ok)
          .map((c) => c.code)
          .join(", ")}`,
      });
    const claim = buildClaimPackage(src, accreditation);
    if (packageDigest(claim) !== exchange.payloadDigest) {
      return this.finish(exchange, "failed", { lastError: "The claim data changed after the submission was requested; prepare and submit it again" });
    }

    const result = await this.gateway.submitClaim(claim, exchange.idempotencyKey);
    switch (result.outcome) {
      case "accepted":
        await this.finish(exchange, "accepted", { externalReference: result.externalReference });
        await this.billing.claimSubmitted({
          organizationId,
          invoiceId: exchange.resourceId,
          invoicePayerId: claim.coverage.invoicePayerId,
          reference: result.externalReference,
          requestedBy: exchange.requestedBy,
        });
        return;
      case "rejected":
        return this.finish(exchange, "rejected", { outcomeDetail: { reasons: result.reasons } });
      case "not_configured":
        return this.finish(exchange, "not_configured", {});
      case "failed": {
        const attempts = exchange.attempts + 1;
        if (!result.retryable || attempts >= MAX_SUBMISSION_ATTEMPTS) return this.finish(exchange, "failed", { lastError: result.error, attempts });
        await this.db
          .update(integrationExchange)
          .set({ attempts, lastError: result.error.slice(0, 2000) })
          .where(eq(integrationExchange.id, exchange.id));
        // Throwing leaves the outbox event pending, so it is retried.
        throw new Error(`PhilHealth claim submission failed (attempt ${attempts}): ${result.error}`);
      }
    }
  }

  async submissions(organizationId: string, invoiceId: string) {
    const rows = await this.db
      .select()
      .from(integrationExchange)
      .where(
        and(
          eq(integrationExchange.organizationId, organizationId),
          eq(integrationExchange.system, PHILHEALTH_ECLAIMS_SYSTEM),
          eq(integrationExchange.resourceType, "billing_invoice"),
          eq(integrationExchange.resourceId, invoiceId),
        ),
      )
      .orderBy(desc(integrationExchange.requestedAt));
    return rows.map(exchangeView);
  }

  // ---- internals -----------------------------------------------------------------------------

  private async load(organizationId: string, invoiceId: string): Promise<{ src: ClaimSources; accreditation: AccreditationSource | null }> {
    const src = await this.sources.forInvoice(organizationId, invoiceId);
    if (!src) throw new NotFoundError("Invoice");
    const accreditation = await this.settings.accreditation(organizationId, src.invoice.facilityId);
    return { src, accreditation };
  }

  private findByKey(organizationId: string, idempotencyKey: string) {
    return this.db
      .select()
      .from(integrationExchange)
      .where(
        and(
          eq(integrationExchange.organizationId, organizationId),
          eq(integrationExchange.system, PHILHEALTH_ECLAIMS_SYSTEM),
          eq(integrationExchange.idempotencyKey, idempotencyKey),
        ),
      )
      .then((rows) => rows[0]);
  }

  private async finish(
    exchange: IntegrationExchangeRecord,
    status: "accepted" | "rejected" | "failed" | "not_configured",
    fields: { externalReference?: string; outcomeDetail?: Record<string, unknown>; lastError?: string; attempts?: number },
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const updated = await tx
        .update(integrationExchange)
        .set({
          status,
          attempts: fields.attempts ?? exchange.attempts + 1,
          externalReference: fields.externalReference ?? null,
          outcomeDetail: fields.outcomeDetail ?? {},
          lastError: fields.lastError?.slice(0, 2000) ?? null,
          completedAt: new Date(),
        })
        .where(and(eq(integrationExchange.id, exchange.id), eq(integrationExchange.status, "queued")))
        .returning({ id: integrationExchange.id });
      if (updated.length === 0) return;
      await this.audit.record(tx, systemActor(exchange.organizationId, null, "philhealth-eclaims"), {
        action: "philhealth.claim.exchange",
        resourceType: "billing_invoice",
        resourceId: exchange.resourceId,
        patientId: exchange.patientId ?? undefined,
        outcome: status === "accepted" ? "success" : "failure",
        metadata: { exchangeId: exchange.id, status, externalReference: fields.externalReference ?? null },
      });
    });
    if (status !== "accepted") this.logger.warn(`PhilHealth claim exchange ${exchange.id} ${status}${fields.lastError ? `: ${fields.lastError}` : ""}`);
  }
}

function exchangeView(row: IntegrationExchangeRecord) {
  return {
    id: row.id,
    status: row.status,
    attempts: row.attempts,
    externalReference: row.externalReference,
    outcomeDetail: row.outcomeDetail,
    lastError: row.lastError,
    requestedBy: row.requestedBy,
    requestedAt: row.requestedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}
