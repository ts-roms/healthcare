import { Injectable, type OnModuleInit } from "@nestjs/common";
import { DomainEventHandlers } from "@healthcare/core";
import { ChargeService } from "./charge.service";

/**
 * Captures charges from clinical events (outbox, at-least-once; capture is
 * idempotent per source). Billing only reacts — it never blocks the clinical
 * workflow and reads clinical data through the BillingSources port.
 */
@Injectable()
export class ChargeCapture implements OnModuleInit {
  constructor(
    private readonly handlers: DomainEventHandlers,
    private readonly charges: ChargeService,
  ) {}

  onModuleInit(): void {
    this.handlers.on("EncounterCompleted", "billing.capture-encounter", (event) => this.charges.captureEncounter(event.organizationId, event.aggregateId));
    this.handlers.on("LaboratoryOrderCreated", "billing.capture-lab-order", (event) => this.charges.captureLabOrder(event.organizationId, event.aggregateId));
    this.handlers.on("LaboratoryOrderCancelled", "billing.cancel-lab-order", (event) => this.charges.cancelLabOrder(event.organizationId, event.aggregateId));
    this.handlers.on("DentalProcedurePerformed", "billing.capture-dental-procedure", (event) =>
      this.charges.captureDentalProcedure(event.organizationId, event.aggregateId),
    );
    this.handlers.on("DentalProcedureEnteredInError", "billing.cancel-dental-procedure", (event) =>
      this.charges.cancelDentalProcedure(event.organizationId, event.aggregateId),
    );
  }
}
