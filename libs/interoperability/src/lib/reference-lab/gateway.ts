import { Inject, Injectable, type Provider } from "@nestjs/common";
import type { ExchangeHandler, ExchangeOutcome, IntegrationSpecification } from "../exchange/exchange-types";
import type { ReferenceLabSendOutPackage } from "./send-out-package";

export const REFERENCE_LAB_SYSTEM = "reference-laboratory";
export const SUBMIT_SEND_OUT = "submit_send_out";

/**
 * Port for sending a dispatch of specimens to a reference laboratory electronically. An adapter maps the platform's
 * format-neutral package to that laboratory's interface (HL7 v2, ASTM, a vendor API…) — an integration dependency: no
 * reference laboratory's specification is on record. Idempotent per key. Results coming back are entered by staff.
 */
export interface ReferenceLabGateway {
  readonly specification: IntegrationSpecification;
  submitSendOut(pkg: ReferenceLabSendOutPackage, idempotencyKey: string): Promise<ExchangeOutcome>;
}
export const REFERENCE_LAB_GATEWAY = Symbol("REFERENCE_LAB_GATEWAY");

/** The default while no reference laboratory interface is specified: transmits nothing and says so. */
export class UnconfiguredReferenceLabGateway implements ReferenceLabGateway {
  readonly specification: IntegrationSpecification = {
    system: REFERENCE_LAB_SYSTEM,
    name: "Reference laboratory interface",
    status: "dependency",
    specificationVersion: null,
    note: "No reference laboratory's electronic interface (HL7 v2, ASTM or vendor API) and agreement are on record. Specimens travel with the printed manifest; results are entered from the reference laboratory's report.",
  };

  submitSendOut(): Promise<ExchangeOutcome> {
    return Promise.resolve({ outcome: "not_configured" });
  }
}

export const referenceLabGatewayProvider: Provider = { provide: REFERENCE_LAB_GATEWAY, useClass: UnconfiguredReferenceLabGateway };

/** Worker side: sends a sealed send-out package through the configured gateway. */
@Injectable()
export class ReferenceLabSendOutHandler implements ExchangeHandler {
  readonly system = REFERENCE_LAB_SYSTEM;
  readonly operation = SUBMIT_SEND_OUT;

  constructor(@Inject(REFERENCE_LAB_GATEWAY) private readonly gateway: ReferenceLabGateway) {}

  send(payload: unknown, idempotencyKey: string): Promise<ExchangeOutcome> {
    return this.gateway.submitSendOut(payload as ReferenceLabSendOutPackage, idempotencyKey);
  }
}
