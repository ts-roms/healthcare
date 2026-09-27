import { type DynamicModule, Module } from "@nestjs/common";
import { type AppConfig, CoreModule } from "@healthcare/core";
import { IntegrationWorkerModule } from "@healthcare/interoperability";

/**
 * Outbound integrations with external systems (PhilHealth eClaims, later DOH reporting and others): sends exchanges
 * the API prepared, with retry and backoff, and records the outcome. It reads no domain data; the API sealed the
 * payload. Scales and fails independently of the API.
 */
@Module({})
export class IntegrationWorkerAppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: IntegrationWorkerAppModule,
      imports: [CoreModule.forRoot(config), IntegrationWorkerModule.forRoot()],
    };
  }
}
