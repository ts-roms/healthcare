import "dotenv/config";
// First: imports are hoisted in order, so telemetry starts before anything that loads http, express, @nestjs/core, pg or ioredis.
import { telemetry } from "./telemetry";
import { ConsoleLogger, Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { telemetryStartupEvent } from "@healthcare/core/telemetry";
import { levelsFrom, loadAppConfig } from "@healthcare/core";
import { startWorkerHealth } from "./health";
import { IntegrationWorkerAppModule } from "./app/app.module";

async function bootstrap(): Promise<void> {
  const config = loadAppConfig();
  // No HTTP server: an application context is enough for a queue consumer.
  const app = await NestFactory.createApplicationContext(IntegrationWorkerAppModule.forRoot(config), {
    // One JSON object per line (docs/architecture/observability.md); plain text in development.
    logger: new ConsoleLogger({ json: config.NODE_ENV === "production", logLevels: levelsFrom(config.LOG_LEVEL) }),
  });
  app.enableShutdownHooks();
  // GET /live and /ready on HEALTH_PORT, when set, for the platform's health probes.
  startWorkerHealth(app, config);
  Logger.log("Integration worker running", "Bootstrap");
  Logger.log(telemetryStartupEvent(telemetry), "Telemetry");
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
