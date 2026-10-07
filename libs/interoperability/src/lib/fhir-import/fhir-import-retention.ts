import { Inject, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { asPlatform, DATABASE, type Database, systemActor } from "@healthcare/core";
import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import { fhirImport, fhirImportContent } from "./fhir-import.schema";

/** The sealed content of a rejected import is kept this long after the rejection, then deleted. */
export const REJECTED_IMPORT_RETENTION_DAYS = 30;
const INTERVAL_MS = 60 * 60 * 1000;
const BATCH = 200;

/**
 * Retention rule for FHIR imports (docs/interoperability/fhir.md): the sealed received content of a rejected import is
 * deleted 30 days after the rejection. The import row, its entries and outcomes remain (no PHI) as the record of what
 * was received and decided. Accepted and partially accepted imports keep their sealed original as provenance of the
 * accepted records.
 */
@Injectable()
export class FhirImportRetention implements OnApplicationShutdown {
  private readonly logger = new Logger(FhirImportRetention.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /** Hourly purge. Called once at API start-up. */
  start(intervalMs = INTERVAL_MS): void {
    this.timer ??= setInterval(() => {
      asPlatform("FHIR import retention", () => this.purge()).catch((error: unknown) =>
        this.logger.error("FHIR import retention failed", error instanceof Error ? error.stack : String(error)),
      );
    }, intervalMs);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Deletes the content of rejected imports older than the retention period. Returns how many were purged. */
  async purge(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - REJECTED_IMPORT_RETENTION_DAYS * 86_400_000);
    let purged = 0;
    for (;;) {
      const batch = await this.db.transaction(async (tx) => {
        const due = await tx
          .select({ id: fhirImport.id, organizationId: fhirImport.organizationId })
          .from(fhirImport)
          .where(and(eq(fhirImport.status, "rejected"), isNull(fhirImport.contentPurgedAt), lt(fhirImport.completedAt, cutoff)))
          .limit(BATCH)
          .for("update", { skipLocked: true });
        if (due.length === 0) return 0;
        const ids = due.map((d) => d.id);
        await tx.delete(fhirImportContent).where(inArray(fhirImportContent.importId, ids));
        await tx.update(fhirImport).set({ contentPurgedAt: now }).where(inArray(fhirImport.id, ids));
        for (const d of due) {
          await this.audit.record(tx, systemActor(d.organizationId, null, "fhir-import-retention"), {
            action: "fhir.import.purge",
            resourceType: "fhir_import",
            resourceId: d.id,
            metadata: { retentionDays: REJECTED_IMPORT_RETENTION_DAYS },
          });
        }
        return due.length;
      });
      purged += batch;
      if (batch < BATCH) return purged;
    }
  }
}
