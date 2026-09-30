import { type DynamicModule, Module, type ModuleMetadata, type Provider, type Type } from "@nestjs/common";
import { philhealthEligibilityGatewayProvider } from "./eligibility";
import { PhilHealthEligibilityController } from "./eligibility.controller";
import { PhilHealthEligibilityService } from "./eligibility.service";
import { philhealthGatewayProvider } from "./gateway";
import { PhilHealthController } from "./philhealth.controller";
import { PhilHealthClaimsService } from "./philhealth-claims.service";
import { PhilHealthRecordQueries } from "./philhealth-record.queries";
import { PhilHealthSettingsService } from "./philhealth-settings.service";
import { PhilHealthOutcomes } from "./philhealth-outcomes";
import {
  PHILHEALTH_BILLING_SINK,
  PHILHEALTH_CLAIM_SOURCES,
  PHILHEALTH_YAKAP_SOURCES,
  type PhilHealthBillingSink,
  type PhilHealthClaimSources,
  type PhilHealthYakapSources,
} from "./ports";
import { philhealthYakapGatewayProvider } from "./yakap";
import { PhilHealthYakapController } from "./yakap.controller";
import { PhilHealthYakapService } from "./yakap.service";

export interface PhilHealthModuleOptions {
  imports?: ModuleMetadata["imports"];
  sources: Type<PhilHealthClaimSources>;
  billing: Type<PhilHealthBillingSink>;
  /** The eClaims adapter (the API reads its specification; the worker sends). Defaults to the unconfigured one. */
  gateway?: Provider;
  /** The eligibility adapter (the API reads its specification; the worker asks). Defaults to the unconfigured one. */
  eligibilityGateway?: Provider;
  /** YAKAP → clinic, prescriptions, laboratory and the patient record (one consultation, the patient's consultations). */
  yakapSources: Type<PhilHealthYakapSources>;
  /** The YAKAP adapter (the API reads its specification; the worker sends). Defaults to the unconfigured one. */
  yakapGateway?: Provider;
}

/** PhilHealth claims (API side): claim preparation from issued invoices, readiness checks, submission requests for the integration worker. */
@Module({})
export class PhilHealthModule {
  static forRoot(options: PhilHealthModuleOptions): DynamicModule {
    return {
      module: PhilHealthModule,
      imports: options.imports ?? [],
      controllers: [PhilHealthController, PhilHealthEligibilityController, PhilHealthYakapController],
      providers: [
        PhilHealthClaimsService,
        PhilHealthRecordQueries,
        PhilHealthSettingsService,
        PhilHealthOutcomes,
        options.gateway ?? philhealthGatewayProvider,
        PhilHealthEligibilityService,
        options.eligibilityGateway ?? philhealthEligibilityGatewayProvider,
        { provide: PHILHEALTH_CLAIM_SOURCES, useClass: options.sources },
        { provide: PHILHEALTH_BILLING_SINK, useClass: options.billing },
        PhilHealthYakapService,
        options.yakapGateway ?? philhealthYakapGatewayProvider,
        { provide: PHILHEALTH_YAKAP_SOURCES, useClass: options.yakapSources },
      ],
      exports: [PhilHealthClaimsService, PhilHealthRecordQueries],
    };
  }
}
