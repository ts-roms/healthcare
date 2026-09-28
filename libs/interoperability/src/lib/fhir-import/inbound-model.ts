/**
 * The platform's own, format-neutral model of what an inbound FHIR resource says (docs/interoperability/fhir.md,
 * "Inbound"). Produced by the pure inbound mappers from a received resource and shown to staff for review; nothing
 * here is a clinical record. Accepting an entry turns it into the owning domain's own record through a port.
 */

export const IMPORT_KINDS = ["patient", "allergy", "condition", "observation", "medication", "document", "not_supported"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

/** FHIR resource types that can be reviewed (everything else is kept as "not supported for import"). */
export const IMPORTABLE_RESOURCE_TYPES = {
  Patient: "patient",
  AllergyIntolerance: "allergy",
  Condition: "condition",
  Observation: "observation",
  MedicationStatement: "medication",
  MedicationRequest: "medication",
  DocumentReference: "document",
} as const satisfies Record<string, Exclude<ImportKind, "not_supported">>;
export type ImportableResourceType = keyof typeof IMPORTABLE_RESOURCE_TYPES;

export function importKind(resourceType: string): ImportKind {
  return (IMPORTABLE_RESOURCE_TYPES as Record<string, ImportKind>)[resourceType] ?? "not_supported";
}

/** A code as the sender declared it (system URI, code, display). */
export interface ImportedCode {
  system: string | null;
  code: string | null;
  display: string | null;
}

/** Whether a clinical entry is about the import's patient (the one Patient resource of the bundle). */
export type SubjectMatch = "import_patient" | "other_patient" | "not_stated";

interface ImportedBase {
  /** The FHIR resource type received. */
  resourceType: string;
  /** Can staff accept it? False with a reason in `notes` (e.g. entered in error at the source). */
  acceptable: boolean;
  /** What staff should know before deciding (not acceptable because…, a value that was not understood, …). */
  notes: string[];
}

export interface ImportedIdentifier {
  system: string | null;
  value: string;
  /** The platform's identifier type when the system is one configured in FHIR_IDENTIFIER_SYSTEMS, else null. */
  type: string | null;
}

export interface ImportedAddress {
  use: string | null;
  lines: string[];
  city: string | null;
  district: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  text: string | null;
}

export interface ImportedPatient extends ImportedBase {
  kind: "patient";
  familyName: string | null;
  givenNames: string[];
  nameText: string | null;
  suffix: string | null;
  /** Platform sex when FHIR gender maps to one (male, female, unknown); "other" is not mapped. */
  sex: "male" | "female" | "unknown" | null;
  gender: string | null;
  birthDate: string | null;
  deceased: boolean;
  identifiers: ImportedIdentifier[];
  telecom: Array<{ system: string | null; value: string; use: string | null }>;
  addresses: ImportedAddress[];
}

export interface ImportedAllergy extends ImportedBase {
  kind: "allergy";
  subject: SubjectMatch;
  substance: string | null;
  codes: ImportedCode[];
  category: "medication" | "food" | "environment" | "biologic" | "other";
  criticality: "low" | "high" | "unable_to_assess";
  severity: "mild" | "moderate" | "severe" | null;
  reaction: string | null;
  clinicalStatus: string | null;
  verificationStatus: string | null;
  recordedDate: string | null;
}

export interface ImportedCondition extends ImportedBase {
  kind: "condition";
  subject: SubjectMatch;
  display: string | null;
  codes: ImportedCode[];
  category: string | null;
  clinicalStatus: string | null;
  verificationStatus: string | null;
  onset: string | null;
  abatement: string | null;
  recordedDate: string | null;
}

export interface ImportedObservation extends ImportedBase {
  kind: "observation";
  subject: SubjectMatch;
  category: "laboratory" | "vital-signs" | "other";
  display: string | null;
  codes: ImportedCode[];
  /** Value as text, e.g. "5.6 mmol/L", "120/80 mm[Hg]" (components), "Positive". */
  value: string | null;
  interpretation: string | null;
  referenceRange: string | null;
  status: string;
  effective: string | null;
}

export interface ImportedMedication extends ImportedBase {
  kind: "medication";
  subject: SubjectMatch;
  /** MedicationStatement (the patient takes / took it) or MedicationRequest (someone prescribed it). */
  statement: "statement" | "request";
  medication: string | null;
  codes: ImportedCode[];
  dosage: string | null;
  status: string;
  date: string | null;
}

export interface ImportedDocument extends ImportedBase {
  kind: "document";
  subject: SubjectMatch;
  type: string | null;
  description: string | null;
  status: string;
  date: string | null;
  /** Attachment metadata only: content is never fetched or kept as a platform document. */
  attachments: Array<{ contentType: string | null; title: string | null; size: number | null; inline: boolean; url: string | null }>;
}

export interface NotSupportedEntry extends ImportedBase {
  kind: "not_supported";
}

export type ImportedItem =
  ImportedPatient | ImportedAllergy | ImportedCondition | ImportedObservation | ImportedMedication | ImportedDocument | NotSupportedEntry;

/**
 * External clinical history, as the clinic domain records it on accept: clearly labelled as from outside, never an
 * internal encounter, diagnosis, vital sign, laboratory result or prescription.
 */
export interface ExternalHistoryInput {
  kind: "condition" | "observation" | "medication" | "document";
  category: string | null;
  display: string;
  codeSystem: string | null;
  code: string | null;
  valueText: string | null;
  statusText: string | null;
  effectiveText: string | null;
}

/** An allergy recorded from an import (unconfirmed: the platform's staff did not verify it). */
export interface ImportedAllergyInput {
  category: ImportedAllergy["category"];
  substance: string;
  reaction?: string;
  severity?: "mild" | "moderate" | "severe";
  criticality: ImportedAllergy["criticality"];
}

/** Where an accepted record came from: the source as declared and the import reference. */
export interface ImportOrigin {
  importId: string;
  entryId: string;
  /** "fhir-import:<import id>#<entry index>" */
  reference: string;
  /** The sender as declared (Bundle.meta.source), else null. */
  declaredSource: string | null;
}
