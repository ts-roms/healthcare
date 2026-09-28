import "dotenv/config";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { CarePlanRecallReminders } from "@healthcare/care-plan";
import { loadAppConfig, OutboxRelay } from "@healthcare/core";
import { DohRescans, FhirImportRetention } from "@healthcare/interoperability";
import { LabReportArchiveWorker } from "@healthcare/laboratory";
import { AppModule } from "./app/app.module";
import { configureApp } from "./app/configure-app";

async function bootstrap(): Promise<void> {
  const config = loadAppConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    logger: levelsFrom(config.LOG_LEVEL),
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
  // Checks of earlier diagnoses against DOH reportable-condition rules, requested by staff.
  app.get(DohRescans).start();
  // Hourly: deletes the sealed content of FHIR imports rejected more than 30 days ago (docs/interoperability/fhir.md).
  app.get(FhirImportRetention).start();
  // Renders released laboratory reports and archives them in object storage (BullMQ, see printable-documents.md).
  app.get(LabReportArchiveWorker).start();
  Logger.log(`API listening on http://localhost:${config.PORT}/api (docs: /api/docs)`, "Bootstrap");
}

function levelsFrom(level: string): Array<"error" | "warn" | "log" | "debug" | "verbose"> {
  const order = ["error", "warn", "log", "debug", "verbose"] as const;
  return order.slice(0, order.indexOf(level as (typeof order)[number]) + 1);
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
