import { Injectable, type OnModuleInit } from "@nestjs/common";
import { DomainEventHandlers } from "@healthcare/core";
import { type ExchangeCompletedPayload, INTEGRATION_EXCHANGE_COMPLETED } from "../exchange/exchange-types";
import { DohReportsService } from "./doh-reports.service";

/** Outbox subscriptions (at-least-once; both handlers are idempotent). */
@Injectable()
export class DohEvents implements OnModuleInit {
  constructor(
    private readonly handlers: DomainEventHandlers,
    private readonly reports: DohReportsService,
  ) {}

  onModuleInit(): void {
    this.handlers.on("DiagnosisRecorded", "doh.detect-case", async (event) => {
      const diagnosisId = (event.payload as { diagnosisId?: string }).diagnosisId;
      if (diagnosisId) await this.reports.detect(event.organizationId, diagnosisId);
    });
    this.handlers.on(INTEGRATION_EXCHANGE_COMPLETED, "doh.case-outcome", (event) =>
      this.reports.exchangeCompleted(event.organizationId, event.payload as unknown as ExchangeCompletedPayload),
    );
  }
}
