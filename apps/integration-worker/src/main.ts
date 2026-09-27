import "dotenv/config";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { loadAppConfig } from "@healthcare/core";
import { IntegrationWorkerAppModule } from "./app/app.module";

async function bootstrap(): Promise<void> {
  const config = loadAppConfig();
  // No HTTP server: an application context is enough for a queue consumer.
  const app = await NestFactory.createApplicationContext(IntegrationWorkerAppModule.forRoot(config));
  app.enableShutdownHooks();
  Logger.log("Integration worker running", "Bootstrap");
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
