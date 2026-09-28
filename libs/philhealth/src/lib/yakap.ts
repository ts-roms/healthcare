import { Inject, Injectable, type Provider } from "@nestjs/common";
import type { ExchangeHandler, ExchangeOutcome, IntegrationSpecification } from "@healthcare/interoperability";
import type { ClaimSourcePatient } from "./claim-package";
import type { YakapRegistrationStatus } from "./philhealth.schema";

/**
 * PhilHealth YAKAP — the platform's side only (docs/interoperability/philhealth-yakap.md). No official YAKAP
 * specification is on record: registration and encounter formats, benefit package contents, first-patient-encounter
 * requirements, capitation, eligibility rules, deadlines and code lists are NOT modelled. What exists is a
 * format-neutral package of one consultation, assembled from the platform's own records, and checks that those
 * records are there at all.
 */

export const PHILHEALTH_YAKAP_SYSTEM = "philhealth-yakap";
export const SUBMIT_YAKAP_ENCOUNTER = "submit_encounter";

/** One consultation as the API gathers it from the clinic, prescriptions, laboratory and the patient record. */
export interface YakapEncounterSource {
  encounter: {
    id: string;
    patientId: string;
    facilityId: string;
    facilityName: string;
    /** The consultation's local date at the facility (YYYY-MM-DD). */
    date: string;
    startedAt: string;
    completedAt: string | null;
    modality: string;
    status: "in_progress" | "completed" | "entered_in_error";
    visitTypeName: string | null;
    clinician: { name: string; profession: string; licenseNumber: string | null } | null;
  };
  patient: ClaimSourcePatient;
  diagnoses: Array<{ codeSystemKey: string | null; code: string | null; display: string; rank: "primary" | "secondary"; certainty: string; status: string }>;
  prescriptions: Array<{
    prescriptionNumber: string;
    status: string;
    issuedAt: string;
    items: Array<{ genericName: string; brandName: string | null; strength: string | null; dosageForm: string | null; quantity: number; quantityUnit: string }>;
  }>;
  labOrders: Array<{
    orderNumber: string;
    status: string;
    orderedAt: string;
    tests: Array<{ code: string; name: string; loincCode: string | null; status: string }>;
  }>;
}

/** A consultation in the patient's list (to choose which one to prepare). */
export interface YakapConsultation {
  encounterId: string;
  facilityId: string;
  facilityName: string;
  date: string;
  modality: string;
  status: "in_progress" | "completed" | "entered_in_error";
  visitTypeName: string | null;
  clinicianName: string | null;
}

export interface YakapParticipationSource {
  participationReference: string;
  validFrom: string | null;
  validUntil: string | null;
}

export interface YakapRegistrationSource {
  status: YakapRegistrationStatus;
  effectiveDate: string | null;
  externalReference: string | null;
  recordedAt: string;
}

/**
 * The platform's own, format-neutral view of one consultation for YAKAP. It is NOT PhilHealth's form or message
 * format — an adapter maps it once the official specification is obtained.
 */
export interface YakapEncounterPackage {
  /** Version of this internal model (not of any PhilHealth specification). */
  model: "platform-yakap-1";
  facility: { id: string; name: string; participationReference: string | null };
  patient: ClaimSourcePatient;
  /** PhilHealth's latest recorded answer about the patient's registration at this facility (as recorded, not decided). */
  registration: { status: YakapRegistrationStatus; effectiveDate: string | null; reference: string | null; recordedAt: string } | null;
  encounter: {
    id: string;
    date: string;
    startedAt: string;
    completedAt: string | null;
    modality: string;
    visitType: string | null;
    clinician: { name: string; profession: string; licenseNumber: string | null } | null;
  };
  diagnoses: Array<{ codeSystem: "icd-10"; code: string; display: string; primary: boolean; certainty: string }>;
  prescriptions: Array<{
    prescriptionNumber: string;
    issuedAt: string;
    items: Array<{ genericName: string; brandName: string | null; strength: string | null; dosageForm: string | null; quantity: number; quantityUnit: string }>;
  }>;
  labOrders: Array<{ orderNumber: string; orderedAt: string; tests: Array<{ code: string; name: string; loincCode: string | null }> }>;
}

export type YakapReadinessCode =
  "encounter_not_signed" | "member_pin_missing" | "participation_missing" | "participation_not_valid" | "diagnosis_code_missing" | "registration_missing";

export interface YakapReadinessCheck {
  code: YakapReadinessCode;
  ok: boolean;
  message: string;
}

const ICD10_KEYS = new Set(["icd-10", "icd10"]);

/**
 * Checks of the platform's OWN data before a YAKAP encounter package can be prepared: is what the package obviously
 * needs recorded at all? PhilHealth's rules (registration or eligibility conditions, first-patient-encounter
 * requirements, benefit package contents, deadlines) are not modelled. A recorded registration answer is required,
 * whatever PhilHealth answered: the platform does not judge the answer.
 */
export function yakapReadiness(
  src: YakapEncounterSource,
  participation: YakapParticipationSource | null,
  registration: YakapRegistrationSource | null,
): YakapReadinessCheck[] {
  const date = src.encounter.date;
  return [
    { code: "encounter_not_signed", ok: src.encounter.status === "completed", message: "The consultation is signed" },
    { code: "member_pin_missing", ok: !!src.patient.philhealthPin, message: "The patient's PhilHealth identification number is recorded" },
    { code: "participation_missing", ok: !!participation, message: "The facility's YAKAP participation reference is recorded" },
    ...(participation
      ? [
          {
            code: "participation_not_valid" as const,
            ok: (!participation.validFrom || participation.validFrom <= date) && (!participation.validUntil || participation.validUntil >= date),
            message: "The recorded participation reference covers the consultation date",
          },
        ]
      : []),
    { code: "diagnosis_code_missing", ok: codedDiagnoses(src).length > 0, message: "The consultation has an ICD-10 coded diagnosis" },
    {
      code: "registration_missing",
      ok: !!registration,
      message: "PhilHealth's answer about the patient's YAKAP registration at this facility is recorded",
    },
  ];
}

export function isYakapReady(checks: YakapReadinessCheck[]): boolean {
  return checks.every((c) => c.ok);
}

/**
 * Builds the package from the platform's records. Only what is in effect is included: active prescriptions (not
 * cancelled or replaced), laboratory orders and tests that were not cancelled, coded diagnoses not entered in error
 * or refuted.
 */
export function buildYakapPackage(
  src: YakapEncounterSource,
  participation: YakapParticipationSource | null,
  registration: YakapRegistrationSource | null,
): YakapEncounterPackage {
  const { encounter } = src;
  return {
    model: "platform-yakap-1",
    facility: { id: encounter.facilityId, name: encounter.facilityName, participationReference: participation?.participationReference ?? null },
    patient: { ...src.patient },
    registration: registration
      ? {
          status: registration.status,
          effectiveDate: registration.effectiveDate,
          reference: registration.externalReference,
          recordedAt: registration.recordedAt,
        }
      : null,
    encounter: {
      id: encounter.id,
      date: encounter.date,
      startedAt: encounter.startedAt,
      completedAt: encounter.completedAt,
      modality: encounter.modality,
      visitType: encounter.visitTypeName,
      clinician: encounter.clinician,
    },
    diagnoses: codedDiagnoses(src)
      .sort((a, b) => (a.rank === b.rank ? a.code!.localeCompare(b.code!) : a.rank === "primary" ? -1 : 1))
      .map((d) => ({ codeSystem: "icd-10" as const, code: d.code!, display: d.display, primary: d.rank === "primary", certainty: d.certainty })),
    prescriptions: src.prescriptions
      .filter((p) => p.status === "active")
      .sort((a, b) => a.issuedAt.localeCompare(b.issuedAt))
      .map((p) => ({ prescriptionNumber: p.prescriptionNumber, issuedAt: p.issuedAt, items: p.items.map((i) => ({ ...i })) })),
    labOrders: src.labOrders
      .filter((o) => o.status !== "cancelled")
      .sort((a, b) => a.orderedAt.localeCompare(b.orderedAt))
      .map((o) => ({
        orderNumber: o.orderNumber,
        orderedAt: o.orderedAt,
        tests: o.tests.filter((t) => t.status !== "cancelled").map((t) => ({ code: t.code, name: t.name, loincCode: t.loincCode })),
      })),
  };
}

function codedDiagnoses(src: YakapEncounterSource) {
  return src.diagnoses.filter(
    (d) => d.status !== "entered_in_error" && d.certainty !== "refuted" && d.code && d.codeSystemKey && ICD10_KEYS.has(d.codeSystemKey.toLowerCase()),
  );
}

// ---- gateway port and the unconfigured adapter -----------------------------------------------------

/**
 * Port for sending a prepared YAKAP encounter package to PhilHealth. An adapter maps the package to the official
 * format and transport — an integration dependency (no specification on record). Idempotent per `idempotencyKey`.
 * The API reads `specification`; the integration worker calls `submitEncounter`.
 */
export interface PhilHealthYakapGateway {
  readonly specification: IntegrationSpecification;
  submitEncounter(pkg: YakapEncounterPackage, idempotencyKey: string): Promise<ExchangeOutcome>;
}
export const PHILHEALTH_YAKAP_GATEWAY = Symbol("PHILHEALTH_YAKAP_GATEWAY");

/** The default while no official YAKAP specification is available: transmits nothing and says so. Never replace it with a guessed format. */
export class UnconfiguredPhilHealthYakapGateway implements PhilHealthYakapGateway {
  readonly specification: IntegrationSpecification = {
    system: PHILHEALTH_YAKAP_SYSTEM,
    name: "PhilHealth YAKAP",
    status: "dependency",
    specificationVersion: null,
    note: "The official PhilHealth YAKAP specification and access have not been obtained. Encounter packages can be prepared and checked, but not transmitted.",
  };

  submitEncounter(): Promise<ExchangeOutcome> {
    return Promise.resolve({ outcome: "not_configured" });
  }
}

export const philhealthYakapGatewayProvider: Provider = { provide: PHILHEALTH_YAKAP_GATEWAY, useClass: UnconfiguredPhilHealthYakapGateway };

/** Worker side: sends a sealed YAKAP encounter package through the configured gateway. */
@Injectable()
export class PhilHealthYakapHandler implements ExchangeHandler {
  readonly system = PHILHEALTH_YAKAP_SYSTEM;
  readonly operation = SUBMIT_YAKAP_ENCOUNTER;

  constructor(@Inject(PHILHEALTH_YAKAP_GATEWAY) private readonly gateway: PhilHealthYakapGateway) {}

  send(payload: unknown, idempotencyKey: string): Promise<ExchangeOutcome> {
    return this.gateway.submitEncounter(payload as YakapEncounterPackage, idempotencyKey);
  }
}
