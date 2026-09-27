import { Inject, Injectable, type Provider } from "@nestjs/common";
import type { ExchangeHandler, ExchangeOutcome, ExchangeReason, IntegrationSpecification } from "../exchange/exchange-types";
import type { AccreditationSource, ClaimSourcePatient } from "./claim-package";

/**
 * PhilHealth eligibility — the platform's side only. PhilHealth's inquiry
 * format, result codes, membership categories and eligibility rules are an
 * integration dependency; the platform records the answer as three states.
 */

export const PHILHEALTH_ELIGIBILITY_SYSTEM = "philhealth-eligibility";
export const CHECK_ELIGIBILITY = "check_eligibility";

export type EligibilityAnswer = "eligible" | "not_eligible" | "undetermined";

/** Format-neutral inquiry: who, where, for which date of service. Not PhilHealth's message format. */
export interface EligibilityInquiry {
  model: "platform-eligibility-1";
  patient: ClaimSourcePatient;
  facility: { id: string; accreditationNumber: string | null };
  serviceDate: string;
}

export type EligibilityReadinessCode = "member_pin_missing" | "accreditation_missing" | "accreditation_not_valid";

export interface EligibilityReadinessCheck {
  code: EligibilityReadinessCode;
  ok: boolean;
  message: string;
}

/** Completeness of the platform's own data before an inquiry can be sent (not PhilHealth's rules). */
export function eligibilityReadiness(patient: ClaimSourcePatient, accreditation: AccreditationSource | null, serviceDate: string): EligibilityReadinessCheck[] {
  return [
    { code: "member_pin_missing", ok: !!patient.philhealthPin, message: "The patient's PhilHealth identification number is recorded" },
    { code: "accreditation_missing", ok: !!accreditation, message: "The facility's PhilHealth accreditation number is recorded" },
    ...(accreditation
      ? [
          {
            code: "accreditation_not_valid" as const,
            ok: (!accreditation.validFrom || accreditation.validFrom <= serviceDate) && (!accreditation.validUntil || accreditation.validUntil >= serviceDate),
            message: "The recorded accreditation covers the date of service",
          },
        ]
      : []),
  ];
}

export function buildEligibilityInquiry(
  patient: ClaimSourcePatient,
  facilityId: string,
  accreditation: AccreditationSource | null,
  serviceDate: string,
): EligibilityInquiry {
  return {
    model: "platform-eligibility-1",
    patient,
    facility: { id: facilityId, accreditationNumber: accreditation?.accreditationNumber ?? null },
    serviceDate,
  };
}

export type EligibilityOutcome =
  | { outcome: "answered"; answer: EligibilityAnswer; externalReference: string; reasons?: ExchangeReason[] }
  | { outcome: "rejected"; reasons: ExchangeReason[] }
  | { outcome: "failed"; retryable: boolean; error: string }
  | { outcome: "not_configured" };

/** Port for asking PhilHealth about a member's eligibility. Idempotent per key. */
export interface PhilHealthEligibilityGateway {
  readonly specification: IntegrationSpecification;
  checkEligibility(inquiry: EligibilityInquiry, idempotencyKey: string): Promise<EligibilityOutcome>;
}
export const PHILHEALTH_ELIGIBILITY_GATEWAY = Symbol("PHILHEALTH_ELIGIBILITY_GATEWAY");

/** The default while no official specification is available: transmits nothing and says so. */
export class UnconfiguredPhilHealthEligibilityGateway implements PhilHealthEligibilityGateway {
  readonly specification: IntegrationSpecification = {
    system: PHILHEALTH_ELIGIBILITY_SYSTEM,
    name: "PhilHealth eligibility",
    status: "dependency",
    specificationVersion: null,
    note: "The official PhilHealth eligibility specification and access have not been obtained. Check through PhilHealth's own channel and record the answer here.",
  };

  checkEligibility(): Promise<EligibilityOutcome> {
    return Promise.resolve({ outcome: "not_configured" });
  }
}

export const philhealthEligibilityGatewayProvider: Provider = { provide: PHILHEALTH_ELIGIBILITY_GATEWAY, useClass: UnconfiguredPhilHealthEligibilityGateway };

/** Worker side: sends a sealed inquiry; an answer travels back as result codes (eligibility, reason codes). */
@Injectable()
export class PhilHealthEligibilityHandler implements ExchangeHandler {
  readonly system = PHILHEALTH_ELIGIBILITY_SYSTEM;
  readonly operation = CHECK_ELIGIBILITY;

  constructor(@Inject(PHILHEALTH_ELIGIBILITY_GATEWAY) private readonly gateway: PhilHealthEligibilityGateway) {}

  async send(payload: unknown, idempotencyKey: string): Promise<ExchangeOutcome> {
    const result = await this.gateway.checkEligibility(payload as EligibilityInquiry, idempotencyKey);
    if (result.outcome !== "answered") return result;
    return {
      outcome: "accepted",
      externalReference: result.externalReference,
      detail: { eligibility: result.answer, ...(result.reasons?.length ? { reasons: result.reasons.map((r) => r.code).join(",") } : {}) },
    };
  }
}
