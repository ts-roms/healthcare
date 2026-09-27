import { Inject, Injectable } from "@nestjs/common";
import {
  type Actor,
  APP_CONFIG,
  type AppConfig,
  type DbExecutor,
  DomainEventPublisher,
  integrationPayloadKeyring,
  type Keyring,
  sealWithKeyring,
  sha256Hex,
} from "@healthcare/core";
import { canonicalJson } from "./canonical-json";
import { integrationExchange, integrationExchangePayload, type IntegrationExchangeRecord } from "./exchange.schema";
import { INTEGRATION_EXCHANGE_REQUESTED } from "./exchange-types";

export interface ExchangeRequest {
  system: string;
  operation: string;
  idempotencyKey: string;
  patientId: string | null;
  resourceType: string;
  resourceId: string;
  facilityId?: string | null;
  /** The prepared payload (may contain PHI): stored encrypted until the exchange is final. */
  payload: unknown;
}

/** SHA-256 of a payload's canonical JSON: identifies what was prepared without keeping it. */
export function payloadDigest(payload: unknown): string {
  return sha256Hex(canonicalJson(payload));
}

/**
 * API side of an outbound exchange: records it (queued), seals the prepared payload for the integration worker and
 * records the request event — all in the caller's transaction, so either everything is queued or nothing is.
 */
@Injectable()
export class IntegrationExchanges {
  private readonly keyring: Keyring;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly events: DomainEventPublisher,
  ) {
    this.keyring = integrationPayloadKeyring(config);
  }

  async request(tx: DbExecutor, actor: Actor, input: ExchangeRequest): Promise<IntegrationExchangeRecord> {
    const plaintext = canonicalJson(input.payload);
    const [row] = (await tx
      .insert(integrationExchange)
      .values({
        organizationId: actor.organizationId,
        system: input.system,
        operation: input.operation,
        idempotencyKey: input.idempotencyKey,
        patientId: input.patientId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        payloadDigest: sha256Hex(plaintext),
        requestedBy: actor.userId,
      })
      .returning()) as [IntegrationExchangeRecord];
    // Sealed with the current key and tagged with its id, so the worker can open it after a key rotation.
    const { keyId, sealed } = sealWithKeyring(plaintext, this.keyring);
    await tx.insert(integrationExchangePayload).values({ exchangeId: row.id, organizationId: actor.organizationId, keyId, ciphertext: sealed });
    await this.events.record(tx, {
      type: INTEGRATION_EXCHANGE_REQUESTED,
      organizationId: actor.organizationId,
      aggregateType: "integration_exchange",
      aggregateId: row.id,
      facilityId: input.facilityId ?? null,
      patientId: input.patientId,
      payload: { system: input.system, operation: input.operation },
    });
    return row;
  }
}
