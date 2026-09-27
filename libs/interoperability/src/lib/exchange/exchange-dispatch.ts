import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { DomainEventHandlers } from "@healthcare/core";
import { INTEGRATION_EXCHANGE_REQUESTED, INTEGRATION_QUEUE, type IntegrationQueue } from "./exchange-types";

/**
 * API side: hands requested exchanges to the integration worker's queue (outbox, at-least-once; the queue dedupes by
 * exchange id). External systems are never called from the API.
 */
@Injectable()
export class ExchangeDispatch implements OnModuleInit {
  constructor(
    private readonly handlers: DomainEventHandlers,
    @Inject(INTEGRATION_QUEUE) private readonly queue: IntegrationQueue,
  ) {}

  onModuleInit(): void {
    this.handlers.on(INTEGRATION_EXCHANGE_REQUESTED, "integration.enqueue", (event) => this.queue.enqueue(event.aggregateId));
  }
}
