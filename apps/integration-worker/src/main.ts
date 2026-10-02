import "dotenv/config";
import { ConsoleLogger, Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
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
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
