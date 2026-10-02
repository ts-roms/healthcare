import "dotenv/config";
import { ConsoleLogger, Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { levelsFrom, loadAppConfig } from "@healthcare/core";
import { startWorkerHealth } from "./health";
import { ExpoPushReceipts } from "@healthcare/notification";
import { WorkerModule } from "./app/app.module";

async function bootstrap(): Promise<void> {
  const config = loadAppConfig();
  // No HTTP server: an application context is enough for a queue consumer.
  const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(config), {
    // One JSON object per line (docs/architecture/observability.md); plain text in development.
    logger: new ConsoleLogger({ json: config.NODE_ENV === "production", logLevels: levelsFrom(config.LOG_LEVEL) }),
  });
  app.enableShutdownHooks();
  // GET /live and /ready on HEALTH_PORT, when set, for the platform's health probes.
  startWorkerHealth(app, config);
  // Receipts of messages sent to the MyHealth app through Expo: gone apps are dropped, delivered notices marked.
  if (config.EXPO_PUSH_ENABLED) app.get(ExpoPushReceipts).start();
  Logger.log("Notification worker running", "Bootstrap");
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
