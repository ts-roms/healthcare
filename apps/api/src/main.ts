import "dotenv/config";
// First: imports are hoisted in order, so telemetry starts before anything that loads http, express, @nestjs/core, pg or ioredis.
import { telemetry } from "./telemetry";
import { ConsoleLogger, Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { CarePlanRecallReminders } from "@healthcare/care-plan";
import { CrmCampaignRuns } from "@healthcare/crm";
import { AutomaticNoShows, WaitlistOffersService } from "@healthcare/clinic";
import { telemetryStartupEvent } from "@healthcare/core/telemetry";
import { levelsFrom, loadAppConfig, malwareScanRequired, OutboxRelay } from "@healthcare/core";
import { DocumentIntegrityService } from "@healthcare/documents";
import { AuditRetentionService } from "./app/audit-retention/audit-retention.service";
import { DohRescans, FhirImportRetention } from "@healthcare/interoperability";
import { LabReportArchiveWorker } from "@healthcare/laboratory";
import { AppModule } from "./app/app.module";
import { configureApp } from "./app/configure-app";
import { IdempotencyPurge } from "./app/idempotency-purge";
import { KioskHousekeeping } from "./app/kiosk/kiosk-housekeeping";
import { LaboratoryQualityReminders } from "./app/laboratory-quality-reminders";
import { PatientMessageReminders } from "./app/portal/patient-message-reminders";
import { CrmApprovalReminders } from "./app/outreach/crm-approval-notices";
import { ManagementReportRuns } from "./app/management-dashboard/management-report-runs";

async function bootstrap(): Promise<void> {
  const config = loadAppConfig();
  // The owner's URL is for the pre-deploy migration only (docs/runbooks/database-roles.md). Railway gives a service's
  // variables to its running process as well, so drop it before any module or dependency can read it.
  delete process.env["MIGRATION_DATABASE_URL"];
  // Fail closed: uploads from patients and other providers reach staff only after a scan (docs/domains/documents.md).
  if (malwareScanRequired(config) && !config.CLAMAV_HOST) {
    throw new Error(
      "CLAMAV_HOST is unset but malware scanning is required (production): configure clamd, or set MALWARE_SCAN_REQUIRED=false to accept uploads as not scanned",
    );
  }
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    // One JSON object per line (docs/architecture/observability.md); plain text in development.
    logger: new ConsoleLogger({ json: config.NODE_ENV === "production", logLevels: levelsFrom(config.LOG_LEVEL) }),
    bufferLogs: true,
    // Payment provider notifications are verified against the exact bytes received.
    rawBody: true,
  });
  configureApp(app, config);
  // Keep idle connections open longer than clients and proxies reuse them (Node's default is 5 s): otherwise the API
  // closes a kept-alive connection just as a client sends on it, and that request fails with ECONNRESET. Headers must
  // be allowed a little longer than the keep-alive window (Node's own rule).
  const server = app.getHttpServer() as import("node:http").Server;
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  await app.listen(config.PORT);
  // Dispatches domain events (queue updates, reminders) written by transactions.
  app.get(OutboxRelay).start();
  // Hourly, daytime only: care-plan follow-up reminders (patient recall).
  app.get(CarePlanRecallReminders).start();
  // Hourly: unattended appointments marked as no-shows after each clinic's hour, where the clinic turned it on.
  app.get(AutomaticNoShows).start();
  // Hourly: waiting-list offers whose hold ran out expire and the time goes to the next entries (docs/domains/clinic.md).
  app.get(WaitlistOffersService).start();
  // Hourly: laboratory temperature readings missed and competency reassessments due (in-app, quality managers).
  app.get(LaboratoryQualityReminders).start();
  app.get(IdempotencyPurge).start();
  app.get(KioskHousekeeping).start();
  // Hourly: MyHealth conversations past the clinic's response target (one in-app reminder per breach; docs/domains/patient-messaging.md).
  app.get(PatientMessageReminders).start();
  // Hourly: outreach campaigns still waiting for approval two days after submission (one in-app reminder to the approvers).
  app.get(CrmApprovalReminders).start();
  // Hourly: scheduled management reports whose period has ended (CSV files stored, recipients told).
  app.get(ManagementReportRuns).start();
  // Every minute: approved outreach campaigns whose time has come (docs/domains/crm.md).
  app.get(CrmCampaignRuns).start();
  // Checks of earlier diagnoses against DOH reportable-condition rules, requested by staff.
  app.get(DohRescans).start();
  // Daily: audit partitions for the coming months; archives of closed months requested by platform administrators
  // (docs/runbooks/audit-retention.md).
  app.get(AuditRetentionService).start();
  // Integrity reviews of stored documents against their checksums, requested by the records office (docs/domains/documents.md).
  app.get(DocumentIntegrityService).start();
  // Hourly: deletes the sealed content of FHIR imports rejected more than 30 days ago (docs/interoperability/fhir.md).
  app.get(FhirImportRetention).start();
  // Renders released laboratory reports and archives them in object storage (BullMQ, see printable-documents.md).
  app.get(LabReportArchiveWorker).start();
  Logger.log(`API listening on http://localhost:${config.PORT}/api (docs: /api/docs)`, "Bootstrap");
  if (config.NODE_ENV === "production" && !config.CLAMAV_HOST) {
    Logger.warn(
      {
        event: "documents.scanner_unconfigured",
        message: "CLAMAV_HOST is unset and MALWARE_SCAN_REQUIRED=false: uploaded documents are recorded as not scanned (docs/domains/documents.md)",
      },
      "Bootstrap",
    );
  }
  Logger.log(telemetryStartupEvent(telemetry), "Telemetry");
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
