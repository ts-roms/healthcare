import { type DynamicModule, Module } from "@nestjs/common";
import { type AppConfig, CoreModule } from "@healthcare/core";
import { IntegrationWorkerModule } from "@healthcare/interoperability";
import { philhealthExchangeHandlers } from "@healthcare/philhealth";

/**
 * Outbound integrations with external systems (PhilHealth eClaims and eligibility, DOH reporting, later others): sends
 * exchanges the API prepared, with retry and backoff, and records the outcome. It reads no domain data; the API sealed
 * the payload. Scales and fails independently of the API. Each adapter family contributes its handlers here.
 */
@Module({})
export class IntegrationWorkerAppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: IntegrationWorkerAppModule,
      imports: [CoreModule.forRoot(config), IntegrationWorkerModule.forRoot({ handlerSets: [philhealthExchangeHandlers()] })],
    };
  }
}
