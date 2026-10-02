import "dotenv/config";
// First: imports are hoisted in order, so telemetry starts before anything that loads http, express, @nestjs/core, pg or ioredis.
import { telemetry } from "./telemetry";
import { ConsoleLogger, Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { CarePlanRecallReminders } from "@healthcare/care-plan";
import { CrmCampaignRuns } from "@healthcare/crm";
import { AutomaticNoShows } from "@healthcare/clinic";
import { telemetryStartupEvent } from "@healthcare/core/telemetry";
import { levelsFrom, loadAppConfig, OutboxRelay } from "@healthcare/core";
import { DohRescans, FhirImportRetention } from "@healthcare/interoperability";
import { LabReportArchiveWorker } from "@healthcare/laboratory";
import { AppModule } from "./app/app.module";
import { configureApp } from "./app/configure-app";
import { LaboratoryQualityReminders } from "./app/laboratory-quality-reminders";
import { ManagementReportRuns } from "./app/management-dashboard/management-report-runs";

async function bootstrap(): Promise<void> {
  const config = loadAppConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    // One JSON object per line (docs/architecture/observability.md); plain text in development.
    logger: new ConsoleLogger({ json: config.NODE_ENV === "production", logLevels: levelsFrom(config.LOG_LEVEL) }),
    bufferLogs: true,
    // Payment provider notifications are verified against the exact bytes received.
    rawBody: true,
  });
  configureApp(app, config);
  await app.listen(config.PORT);
  // Dispatches domain events (queue updates, reminders) written by transactions.
  app.get(OutboxRelay).start();
  // Hourly, daytime only: care-plan follow-up reminders (patient recall).
  app.get(CarePlanRecallReminders).start();
  // Hourly: unattended appointments marked as no-shows after each clinic's hour, where the clinic turned it on.
  app.get(AutomaticNoShows).start();
  // Hourly: laboratory temperature readings missed and competency reassessments due (in-app, quality managers).
  app.get(LaboratoryQualityReminders).start();
  // Hourly: scheduled management reports whose period has ended (CSV files stored, recipients told).
  app.get(ManagementReportRuns).start();
  // Every minute: approved outreach campaigns whose time has come (docs/domains/crm.md).
  app.get(CrmCampaignRuns).start();
  // Checks of earlier diagnoses against DOH reportable-condition rules, requested by staff.
  app.get(DohRescans).start();
  // Hourly: deletes the sealed content of FHIR imports rejected more than 30 days ago (docs/interoperability/fhir.md).
  app.get(FhirImportRetention).start();
  // Renders released laboratory reports and archives them in object storage (BullMQ, see printable-documents.md).
  app.get(LabReportArchiveWorker).start();
  Logger.log(`API listening on http://localhost:${config.PORT}/api (docs: /api/docs)`, "Bootstrap");
  Logger.log(telemetryStartupEvent(telemetry), "Telemetry");
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
