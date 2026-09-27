import { type DynamicModule, Module, type ModuleMetadata, type Provider, type Type } from "@nestjs/common";
import { PHILHEALTH_CLAIMS_GATEWAY, type PhilHealthClaimsGateway, UnconfiguredPhilHealthGateway } from "./gateway";
import { PhilHealthController } from "./philhealth.controller";
import { PhilHealthClaimsService } from "./philhealth-claims.service";
import { PhilHealthSettingsService } from "./philhealth-settings.service";
import { PhilHealthSubmissions } from "./philhealth-submissions";
import { PHILHEALTH_BILLING_SINK, PHILHEALTH_CLAIM_SOURCES, type PhilHealthBillingSink, type PhilHealthClaimSources } from "./ports";

export interface PhilHealthModuleOptions {
  imports?: ModuleMetadata["imports"];
  sources: Type<PhilHealthClaimSources>;
  billing: Type<PhilHealthBillingSink>;
  /** The eClaims adapter. Defaults to the unconfigured one (transmits nothing) until the official specification is obtained. */
  gateway?: Type<PhilHealthClaimsGateway> | Provider;
}

/** PhilHealth claims (Phase 8): claim preparation from issued invoices, readiness checks, exchange log, gateway port. */
@Module({})
export class PhilHealthModule {
  static forRoot(options: PhilHealthModuleOptions): DynamicModule {
    const gateway: Provider =
      options.gateway && "provide" in options.gateway
        ? options.gateway
        : { provide: PHILHEALTH_CLAIMS_GATEWAY, useClass: (options.gateway as Type<PhilHealthClaimsGateway> | undefined) ?? UnconfiguredPhilHealthGateway };
    return {
      module: PhilHealthModule,
      imports: options.imports ?? [],
      controllers: [PhilHealthController],
      providers: [
        PhilHealthClaimsService,
        PhilHealthSettingsService,
        PhilHealthSubmissions,
        gateway,
        { provide: PHILHEALTH_CLAIM_SOURCES, useClass: options.sources },
        { provide: PHILHEALTH_BILLING_SINK, useClass: options.billing },
      ],
      exports: [PhilHealthClaimsService],
    };
  }
}
