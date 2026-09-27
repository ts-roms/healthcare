import { type DynamicModule, Module, type ModuleMetadata, type Provider, type Type } from "@nestjs/common";
import { philhealthEligibilityGatewayProvider } from "./eligibility";
import { PhilHealthEligibilityController } from "./eligibility.controller";
import { PhilHealthEligibilityService } from "./eligibility.service";
import { philhealthGatewayProvider } from "./gateway";
import { PhilHealthController } from "./philhealth.controller";
import { PhilHealthClaimsService } from "./philhealth-claims.service";
import { PhilHealthSettingsService } from "./philhealth-settings.service";
import { PhilHealthOutcomes } from "./philhealth-outcomes";
import { PHILHEALTH_BILLING_SINK, PHILHEALTH_CLAIM_SOURCES, type PhilHealthBillingSink, type PhilHealthClaimSources } from "./ports";

export interface PhilHealthModuleOptions {
  imports?: ModuleMetadata["imports"];
  sources: Type<PhilHealthClaimSources>;
  billing: Type<PhilHealthBillingSink>;
  /** The eClaims adapter (the API reads its specification; the worker sends). Defaults to the unconfigured one. */
  gateway?: Provider;
  /** The eligibility adapter (the API reads its specification; the worker asks). Defaults to the unconfigured one. */
  eligibilityGateway?: Provider;
}

/** PhilHealth claims (API side): claim preparation from issued invoices, readiness checks, submission requests for the integration worker. */
@Module({})
export class PhilHealthModule {
  static forRoot(options: PhilHealthModuleOptions): DynamicModule {
    return {
      module: PhilHealthModule,
      imports: options.imports ?? [],
      controllers: [PhilHealthController, PhilHealthEligibilityController],
      providers: [
        PhilHealthClaimsService,
        PhilHealthSettingsService,
        PhilHealthOutcomes,
        options.gateway ?? philhealthGatewayProvider,
        PhilHealthEligibilityService,
        options.eligibilityGateway ?? philhealthEligibilityGatewayProvider,
        { provide: PHILHEALTH_CLAIM_SOURCES, useClass: options.sources },
        { provide: PHILHEALTH_BILLING_SINK, useClass: options.billing },
      ],
      exports: [PhilHealthClaimsService],
    };
  }
}
