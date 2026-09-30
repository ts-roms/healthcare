import "dotenv/config";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { loadAppConfig } from "@healthcare/core";
import { ExpoPushReceipts } from "@healthcare/notification";
import { WorkerModule } from "./app/app.module";

async function bootstrap(): Promise<void> {
  const config = loadAppConfig();
  // No HTTP server: an application context is enough for a queue consumer.
  const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(config));
  app.enableShutdownHooks();
  // Receipts of messages sent to the MyHealth app through Expo: gone apps are dropped, delivered notices marked.
  if (config.EXPO_PUSH_ENABLED) app.get(ExpoPushReceipts).start();
  Logger.log("Notification worker running", "Bootstrap");
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
