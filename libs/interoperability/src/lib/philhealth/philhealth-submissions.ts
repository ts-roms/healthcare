import { Injectable, type OnModuleInit } from "@nestjs/common";
import { DomainEventHandlers } from "@healthcare/core";
import { CLAIM_SUBMISSION_REQUESTED, PhilHealthClaimsService } from "./philhealth-claims.service";

/**
 * Sends queued claims from the outbox (at-least-once; processing is idempotent).
 * When a real adapter exists, this moves to apps/integration-worker (BullMQ, retry
 * with backoff, dead-letter) so external calls never run in the API's outbox relay.
 */
@Injectable()
export class PhilHealthSubmissions implements OnModuleInit {
  constructor(
    private readonly handlers: DomainEventHandlers,
    private readonly claims: PhilHealthClaimsService,
  ) {}

  onModuleInit(): void {
    this.handlers.on(CLAIM_SUBMISSION_REQUESTED, "philhealth.submit-claim", (event) => this.claims.process(event.organizationId, event.aggregateId));
  }
}
