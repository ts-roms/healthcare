/**
 * Where an external specification stands (docs/interoperability/dependencies.md):
 * "dependency" — not obtained, nothing is transmitted; "stubbed" — an adapter exists against a documented but
 * uncertified specification; "implemented"; "certified" — accepted by the external party.
 */
export type SpecificationStatus = "dependency" | "stubbed" | "implemented" | "certified";

export interface IntegrationSpecification {
  system: string;
  name: string;
  status: SpecificationStatus;
  /** The external specification's own version, once obtained. */
  specificationVersion: string | null;
  note: string;
}

/** Reasons or codes returned by an external system; no clinical free text. */
export interface ExchangeReason {
  code: string;
  message: string;
}

/** What an adapter reports for one outbound operation. */
export type ExchangeOutcome =
  | { outcome: "accepted"; externalReference: string }
  | { outcome: "rejected"; reasons: ExchangeReason[] }
  | { outcome: "failed"; retryable: boolean; error: string }
  | { outcome: "not_configured" };

/**
 * Sends one kind of prepared payload (system + operation) to an external system. Runs in the integration worker.
 * Must be idempotent per `idempotencyKey` (the worker retries).
 */
export interface ExchangeHandler {
  readonly system: string;
  readonly operation: string;
  send(payload: unknown, idempotencyKey: string): Promise<ExchangeOutcome>;
}
export const EXCHANGE_HANDLERS = Symbol("EXCHANGE_HANDLERS");

/** Hands an exchange to the integration worker. The job carries only the exchange id. */
export interface IntegrationQueue {
  enqueue(exchangeId: string): Promise<void>;
}
export const INTEGRATION_QUEUE = Symbol("INTEGRATION_QUEUE");

/** Outbox events: the API asks for an exchange to be sent; the worker reports its final status. Payloads carry ids and codes. */
export const INTEGRATION_EXCHANGE_REQUESTED = "IntegrationExchangeRequested";
export const INTEGRATION_EXCHANGE_COMPLETED = "IntegrationExchangeCompleted";

export interface ExchangeCompletedPayload {
  exchangeId: string;
  system: string;
  operation: string;
  status: "accepted" | "rejected" | "failed" | "not_configured";
  resourceType: string;
  resourceId: string;
  externalReference: string | null;
  requestedBy: string;
}
