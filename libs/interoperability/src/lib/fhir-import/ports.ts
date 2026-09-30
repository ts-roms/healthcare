import type { Actor, DbExecutor } from "@healthcare/core";
import type {
  ExternalHistoryInput,
  ImportedAllergyInput,
  ImportedFamilyHistoryInput,
  ImportedImmunizationInput,
  ImportedPastProcedureInput,
  ImportOrigin,
} from "./inbound-model";

/** A new patient as the imported Patient describes it (the patient domain validates it like any registration). */
export interface RegistrationDraft {
  familyName: string;
  givenName: string;
  suffix?: string;
  sex: "male" | "female" | "unknown";
  birthDate: string;
  contacts: Array<{ system: "mobile" | "phone" | "email"; value: string }>;
  addresses: Array<{ line1?: string; cityMunicipality: string; province?: string; region?: string; postalCode?: string }>;
  identifiers: Array<{ type: string; value: string }>;
}

export interface ImportPatientBrief {
  id: string;
  patientNumber: string;
  displayName: string;
  sex: string;
  birthDate: string;
  status: string;
}

export interface ImportPatientCandidate {
  patient: ImportPatientBrief;
  level: "certain" | "high" | "possible";
  reasons: string[];
}

export interface DuplicateOverride {
  reviewedCandidateIds: string[];
  reason: string;
}

/**
 * What FHIR imports need from the patient and clinic domains, implemented by the app's composition root
 * (apps/api/src/app/adapters/fhir-import-adapters.ts). This library never reads or writes their tables; accepting an
 * entry goes through the owning domain's own commands, validation and audit.
 */
export interface FhirImportTargets {
  /** Patient number, name, sex, birth date and status; undefined when not a patient of the organization. */
  patient(organizationId: string, patientId: string): Promise<ImportPatientBrief | undefined>;
  /** Patient number and name for lists. */
  patientBriefs(organizationId: string, patientIds: string[]): Promise<Map<string, { patientNumber: string; displayName: string }>>;
  /**
   * The draft keeps only what the patient domain accepts (contacts it can normalise, identifier types it knows);
   * undefined when a required element (name, full birth date, sex) is missing.
   */
  refineDraft(draft: RegistrationDraft): RegistrationDraft | undefined;
  /** Duplicate-detection candidates for the draft (the patient domain's own check, audited there). */
  duplicateCandidates(actor: Actor, draft: RegistrationDraft): Promise<ImportPatientCandidate[]>;
  /** Registers through the patient domain (the same duplicate review as the registration form). Returns the patient id. */
  registerPatient(actor: Actor, draft: RegistrationDraft, duplicateOverride?: DuplicateOverride): Promise<string>;
  /** Records the allergy in the clinic domain, in the caller's transaction. Returns the allergy id. */
  recordAllergy(tx: DbExecutor, actor: Actor, patientId: string, input: ImportedAllergyInput, origin: ImportOrigin): Promise<string>;
  /** Records external clinical history in the clinic domain, in the caller's transaction. Returns the entry id. */
  recordExternalHistory(tx: DbExecutor, actor: Actor, patientId: string, input: ExternalHistoryInput, origin: ImportOrigin): Promise<string>;
  /** Records an immunization (source external_import) in the clinic domain, in the caller's transaction. Returns its id. */
  recordImmunization(tx: DbExecutor, actor: Actor, patientId: string, input: ImportedImmunizationInput, origin: ImportOrigin): Promise<string>;
  /** Records a past procedure (source external_import) in the clinic's patient history, in the caller's transaction. Returns its id. */
  recordPastProcedure(tx: DbExecutor, actor: Actor, patientId: string, input: ImportedPastProcedureInput, origin: ImportOrigin): Promise<string>;
  /** Records family history entries (source external_import), in the caller's transaction. Returns their ids, in order. */
  recordFamilyHistory(tx: DbExecutor, actor: Actor, patientId: string, input: ImportedFamilyHistoryInput[], origin: ImportOrigin): Promise<string[]>;
}

export const FHIR_IMPORT_TARGETS = Symbol("FHIR_IMPORT_TARGETS");
