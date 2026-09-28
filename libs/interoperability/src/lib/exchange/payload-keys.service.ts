import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { type Actor, APP_CONFIG, type AppConfig, DATABASE, type Database, integrationPayloadKeyring, type Keyring } from "@healthcare/core";
import { sql } from "drizzle-orm";
import { fhirImportContent } from "../fhir-import/fhir-import.schema";
import { integrationExchangePayload } from "./exchange.schema";

export interface PayloadKeyUsage {
  /** null: sealed before key ids existed ("v1", opened by trying each configured key). */
  keyId: string | null;
  /** Listed in this API instance's key ring (INTEGRATION_PAYLOAD_KEYS / INTEGRATION_PAYLOAD_KEY). */
  configured: boolean;
  /** The key new values are sealed with. */
  current: boolean;
  /** Prepared payloads still waiting for the integration worker (deleted once their exchange is final). */
  queuedPayloads: number;
  /** Received FHIR import content kept sealed (rejected imports are purged after 30 days; accepted ones are kept). */
  importContents: number;
}

/**
 * Which integration payload keys stored values still need, across every organization (the key ring is one platform
 * secret): what an operator checks before removing a key (docs/runbooks/integration-payload-key-rotation.md).
 * Counts and key ids only — never content, organizations or patients.
 */
@Injectable()
export class PayloadKeyUsageService {
  private readonly keyring: Keyring;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly audit: AuditService,
  ) {
    this.keyring = integrationPayloadKeyring(config);
  }

  async usage(actor: Actor): Promise<{ currentKeyId: string; keys: PayloadKeyUsage[] }> {
    const count = async (table: typeof integrationExchangePayload | typeof fhirImportContent) => {
      const rows = await this.db
        .select({ keyId: table.keyId, n: sql<number>`count(*)`.mapWith(Number) })
        .from(table)
        .groupBy(table.keyId);
      return new Map(rows.map((r) => [r.keyId, r.n]));
    };
    const [payloads, imports] = await Promise.all([count(integrationExchangePayload), count(fhirImportContent)]);
    const ids = new Set<string | null>([...this.keyring.keys.keys(), ...payloads.keys(), ...imports.keys()]);
    const keys = [...ids]
      .map((keyId) => ({
        keyId,
        configured: keyId === null ? this.keyring.keys.size > 0 : this.keyring.keys.has(keyId),
        current: keyId === this.keyring.currentKeyId,
        queuedPayloads: payloads.get(keyId) ?? 0,
        importContents: imports.get(keyId) ?? 0,
      }))
      // Current first, then by id (null — before key ids — last).
      .sort((a, b) => Number(b.current) - Number(a.current) || (a.keyId ?? "￿").localeCompare(b.keyId ?? "￿"));
    await this.audit.recordStandalone(actor, {
      action: "integration.payload-keys.view",
      resourceType: "integration_payload_key",
      metadata: { keys: keys.length },
    });
    return { currentKeyId: this.keyring.currentKeyId, keys };
  }
}
