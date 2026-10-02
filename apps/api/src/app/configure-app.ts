import { type INestApplication, VersioningType } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import type { AppConfig } from "@healthcare/core";
import helmet from "helmet";
import { cleanupOpenApiDoc } from "nestjs-zod";
import { ConfiguredIoAdapter, type RealtimeRedisOptions } from "./realtime/io-adapter";

export interface ConfigureAppOptions {
  /** Where live updates are shared between instances; `null` keeps them on this instance only (tests). */
  realtime?: RealtimeRedisOptions | null;
}

/** HTTP concerns shared by main.ts and the API integration tests. */
export function configureApp(app: NestExpressApplication, config: AppConfig, options: ConfigureAppOptions = {}): INestApplication {
  app.setGlobalPrefix("api");
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
  app.use(helmet());
  app.enableCors({ origin: config.CORS_ORIGINS, credentials: true });
  app.disable("x-powered-by");
  if (config.TRUST_PROXY) app.set("trust proxy", 1);
  // Clinical payloads are small JSON; files go straight to object storage. FHIR imports arrive as application/fhir+json.
  app.useBodyParser("json", { limit: "1mb", type: ["application/json", "application/fhir+json"] });
  app.enableShutdownHooks();
  const realtime = options.realtime === undefined ? { redisUrl: config.REDIS_URL } : options.realtime;
  app.useWebSocketAdapter(new ConfiguredIoAdapter(app, config.CORS_ORIGINS, realtime ?? undefined));

  if (config.NODE_ENV !== "production") {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle("Healthcare Platform API")
        .setVersion("1")
        .addBearerAuth()
        .addGlobalParameters(
          { name: "X-Facility-Id", in: "header", required: false, schema: { type: "string", format: "uuid" } },
          { name: "X-Request-Id", in: "header", required: false, schema: { type: "string" } },
        )
        .build(),
    );
    SwaggerModule.setup("api/docs", app, cleanupOpenApiDoc(document));
  }
  return app;
}
