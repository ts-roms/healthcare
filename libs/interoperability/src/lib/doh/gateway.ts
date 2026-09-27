import { Inject, Injectable, type Provider } from "@nestjs/common";
import type { ExchangeHandler, ExchangeOutcome, IntegrationSpecification } from "../exchange/exchange-types";
import type { DohCasePackage } from "./doh.rules";

export const DOH_REPORTING_SYSTEM = "doh-reporting";
export const SUBMIT_CASE_REPORT = "submit_case_report";

/**
 * Port for sending a confirmed case report to DOH. An adapter maps the
 * platform's format-neutral package to the official format and transport —
 * an integration dependency (no specification on record). Idempotent per key.
 */
export interface DohReportingGateway {
  readonly specification: IntegrationSpecification;
  submitCaseReport(report: DohCasePackage, idempotencyKey: string): Promise<ExchangeOutcome>;
}
export const DOH_REPORTING_GATEWAY = Symbol("DOH_REPORTING_GATEWAY");

/** The default while no official DOH reporting specification is available: transmits nothing and says so. */
export class UnconfiguredDohReportingGateway implements DohReportingGateway {
  readonly specification: IntegrationSpecification = {
    system: DOH_REPORTING_SYSTEM,
    name: "DOH disease reporting",
    status: "dependency",
    specificationVersion: null,
    note: "The official DOH reporting specification and access have not been obtained. Case reports are detected and reviewed here and reported through DOH's own channel.",
  };

  submitCaseReport(): Promise<ExchangeOutcome> {
    return Promise.resolve({ outcome: "not_configured" });
  }
}

export const dohGatewayProvider: Provider = { provide: DOH_REPORTING_GATEWAY, useClass: UnconfiguredDohReportingGateway };

/** Worker side: sends a sealed case package through the configured gateway. */
@Injectable()
export class DohCaseReportHandler implements ExchangeHandler {
  readonly system = DOH_REPORTING_SYSTEM;
  readonly operation = SUBMIT_CASE_REPORT;

  constructor(@Inject(DOH_REPORTING_GATEWAY) private readonly gateway: DohReportingGateway) {}

  send(payload: unknown, idempotencyKey: string): Promise<ExchangeOutcome> {
    return this.gateway.submitCaseReport(payload as DohCasePackage, idempotencyKey);
  }
}
