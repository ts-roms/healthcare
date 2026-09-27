import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { type Actor, BusinessRuleError, ConflictError, DATABASE, type Database, NotFoundError } from "@healthcare/core";
import { and, desc, eq, inArray } from "drizzle-orm";
import { integrationExchange, type IntegrationExchangeRecord } from "../exchange/exchange.schema";
import { IntegrationExchanges } from "../exchange/integration-exchanges.service";
import { type AccreditationSource, buildClaimPackage, claimReadiness, type ClaimSources, isReady, maskPin } from "./claim-package";
import { PHILHEALTH_CLAIMS_GATEWAY, PHILHEALTH_ECLAIMS_SYSTEM, type PhilHealthClaimsGateway } from "./gateway";
import { SUBMIT_CLAIM } from "./philhealth-claim-handler";
import { PhilHealthSettingsService } from "./philhealth-settings.service";
import { PHILHEALTH_CLAIM_SOURCES, type PhilHealthClaimSources } from "./ports";

/**
 * Prepares PhilHealth claims from issued invoices (API side). The default
 * gateway is unconfigured (no official eClaims specification on record): claims
 * can be prepared and checked, but a submission is refused rather than faked.
 * With an adapter, a submission is prepared here and sent by the integration
 * worker (docs/architecture/integration-worker.md).
 */
@Injectable()
export class PhilHealthClaimsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(PHILHEALTH_CLAIMS_GATEWAY) private readonly gateway: PhilHealthClaimsGateway,
    @Inject(PHILHEALTH_CLAIM_SOURCES) private readonly sources: PhilHealthClaimSources,
    private readonly settings: PhilHealthSettingsService,
    private readonly exchanges: IntegrationExchanges,
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
   * Queues a submission for the integration worker (the prepared claim is sealed for it). Refused while the eClaims specification is an
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
      const row = await this.exchanges.request(tx, actor, {
        system: PHILHEALTH_ECLAIMS_SYSTEM,
        operation: SUBMIT_CLAIM,
        idempotencyKey,
        patientId: src.invoice.patientId,
        resourceType: "billing_invoice",
        resourceId: invoiceId,
        facilityId: src.invoice.facilityId,
        payload: claim,
      });
      await this.audit.record(tx, actor, {
        action: "philhealth.claim.submit-request",
        resourceType: "billing_invoice",
        resourceId: invoiceId,
        patientId: src.invoice.patientId,
        metadata: { exchangeId: row.id, amountClaimed: claim.coverage.amountClaimed },
      });
      return row;
    });
    return exchangeView(created);
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
