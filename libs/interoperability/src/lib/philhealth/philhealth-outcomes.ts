import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { DomainEventHandlers } from "@healthcare/core";
import { type ExchangeCompletedPayload, INTEGRATION_EXCHANGE_COMPLETED } from "../exchange/exchange-types";
import { PHILHEALTH_ECLAIMS_SYSTEM } from "./gateway";
import { SUBMIT_CLAIM } from "./philhealth-claim-handler";
import { PHILHEALTH_BILLING_SINK, PHILHEALTH_CLAIM_SOURCES, type PhilHealthBillingSink, type PhilHealthClaimSources } from "./ports";

/**
 * API side: when the worker reports that PhilHealth acknowledged a claim, billing records the reference on the
 * invoice's PhilHealth coverage line (outbox, at-least-once; billing ignores a line already past "pending").
 */
@Injectable()
export class PhilHealthOutcomes implements OnModuleInit {
  constructor(
    private readonly handlers: DomainEventHandlers,
    @Inject(PHILHEALTH_CLAIM_SOURCES) private readonly sources: PhilHealthClaimSources,
    @Inject(PHILHEALTH_BILLING_SINK) private readonly billing: PhilHealthBillingSink,
  ) {}

  onModuleInit(): void {
    this.handlers.on(INTEGRATION_EXCHANGE_COMPLETED, "philhealth.claim-outcome", async (event) => {
      const outcome = event.payload as unknown as ExchangeCompletedPayload;
      if (outcome.system !== PHILHEALTH_ECLAIMS_SYSTEM || outcome.operation !== SUBMIT_CLAIM || outcome.status !== "accepted" || !outcome.externalReference)
        return;
      const src = await this.sources.forInvoice(event.organizationId, outcome.resourceId);
      const coverage = src?.invoice.payers.find((p) => p.payerType === "philhealth");
      if (!coverage) return;
      await this.billing.claimSubmitted({
        organizationId: event.organizationId,
        invoiceId: outcome.resourceId,
        invoicePayerId: coverage.id,
        reference: outcome.externalReference,
        requestedBy: outcome.requestedBy,
      });
    });
  }
}
