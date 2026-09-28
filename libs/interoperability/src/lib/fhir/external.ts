import type { CodeableConcept, Condition, DocumentReference, MedicationStatement, Observation } from "fhir/r4";
import type { ExternalHistorySource, FhirContext } from "./sources";
import { compact, concept, externalMeta, ref, text } from "./support";
import { SYSTEMS } from "./terminology";

/**
 * External history (records received from other systems and accepted by staff from a FHIR import) as FHIR R4. Each
 * resource carries the external-source tag (`meta.tag`, see `externalSourceTag`) and says so in a note; none is
 * presented as this organization's own record: no encounter, performer, custodian, issued time or content URL, and
 * conditions are always `unconfirmed`. Values are exported as they were kept (text as received). An entry marked
 * entered in error is exported with the `entered-in-error` status, like the platform's own records.
 */

/** R4 `dateTime` (a time needs seconds and a zone) and `instant`; anything else received is kept as text. */
const DATE_TIME = /^\d{4}(-\d{2}(-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2}))?)?)?$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const isDateTime = (v: string | null): v is string => v !== null && DATE_TIME.test(v);

const IMPORTED_NOTE = "Imported from another system; not verified by this organization.";

function meta(ctx: FhirContext, e: ExternalHistorySource) {
  // Reliable: an entry never changes except being marked entered in error (database trigger).
  return externalMeta(ctx, { lastUpdated: e.enteredInErrorAt ?? e.recordedAt, declaredSource: e.declaredSource });
}

function notes(...lines: Array<string | null | undefined | false>) {
  return [IMPORTED_NOTE, ...lines].filter((l): l is string => Boolean(l)).map((t) => ({ text: t }));
}

/** The code as received: its coding (system and code when sent) with the display as text. */
function code(e: ExternalHistorySource): CodeableConcept {
  return e.code ? { coding: [compact({ system: e.codeSystem ?? undefined, code: e.code, display: e.display })], text: e.display } : text(e.display);
}

const CONDITION_CLINICAL = new Set(["active", "recurrence", "relapse", "inactive", "remission", "resolved"]);
const CONDITION_CATEGORIES: Record<string, string> = { "problem-list-item": "Problem List Item", "encounter-diagnosis": "Encounter Diagnosis" };

/**
 * A condition from another system: `unconfirmed` whatever the sender said (the sender's statuses are kept in a note),
 * the clinical status as received when it was one, no encounter.
 */
export function toExternalCondition(ctx: FhirContext, patientId: string, e: ExternalHistorySource): Condition {
  const inError = e.status === "entered_in_error";
  // Kept as "clinical · verification" text (either may be absent); the two code sets do not overlap.
  const clinical = (e.statusText ?? "").split(" · ").find((t) => CONDITION_CLINICAL.has(t));
  const category = e.category ? CONDITION_CATEGORIES[e.category] : undefined;
  return compact<Condition>({
    resourceType: "Condition",
    id: e.id,
    meta: meta(ctx, e),
    // con-5: no clinical status when entered in error.
    clinicalStatus: !inError && clinical ? concept({ system: SYSTEMS.conditionClinical, code: clinical }) : undefined,
    verificationStatus: concept({ system: SYSTEMS.conditionVerification, code: inError ? "entered-in-error" : "unconfirmed" }),
    category: e.category ? [category ? concept({ system: SYSTEMS.conditionCategory, code: e.category, display: category }) : text(e.category)] : undefined,
    code: code(e),
    subject: ref("Patient", patientId),
    onsetDateTime: isDateTime(e.effectiveText) ? e.effectiveText : undefined,
    onsetString: e.effectiveText && !isDateTime(e.effectiveText) ? e.effectiveText : undefined,
    note: notes(e.statusText && `Status at the source: ${e.statusText}`, e.valueText),
  });
}

const OBSERVATION_STATUS = new Set(["registered", "preliminary", "final", "amended", "corrected", "cancelled", "entered-in-error", "unknown"]);
const OBSERVATION_CATEGORY: Record<string, string> = { laboratory: "Laboratory", "vital-signs": "Vital Signs" };

/**
 * An observation from another system (laboratory, vital sign or other), with the status as received and the value as
 * the text that was kept (value, interpretation, reference range). Never a released laboratory result or a vital sign
 * set of the platform: no performer, issued time, order or encounter.
 */
export function toExternalObservation(ctx: FhirContext, patientId: string, e: ExternalHistorySource): Observation {
  const status = e.status === "entered_in_error" ? "entered-in-error" : e.statusText && OBSERVATION_STATUS.has(e.statusText) ? e.statusText : "unknown";
  const category = e.category ? OBSERVATION_CATEGORY[e.category] : undefined;
  return compact<Observation>({
    resourceType: "Observation",
    id: e.id,
    meta: meta(ctx, e),
    status: status as Observation["status"],
    category: category && e.category ? [concept({ system: SYSTEMS.observationCategory, code: e.category, display: category })] : undefined,
    code: code(e),
    subject: ref("Patient", patientId),
    effectiveDateTime: isDateTime(e.effectiveText) ? e.effectiveText : undefined,
    valueString: e.valueText ?? undefined,
    note: notes(e.effectiveText && !isDateTime(e.effectiveText) && `Date at the source: ${e.effectiveText}`),
  });
}

const MEDICATION_STATEMENT_STATUS = new Set(["active", "completed", "entered-in-error", "intended", "stopped", "on-hold", "unknown", "not-taken"]);

/**
 * A medication from another system as a MedicationStatement (what the patient is reported to take), whether the
 * sender sent a MedicationStatement or a MedicationRequest ("prescribed elsewhere"): never a prescription of the
 * platform. The status as received when it is a MedicationStatement status, else `unknown` (the received one in a note).
 */
export function toExternalMedicationStatement(ctx: FhirContext, patientId: string, e: ExternalHistorySource): MedicationStatement {
  const received = e.statusText && MEDICATION_STATEMENT_STATUS.has(e.statusText) ? e.statusText : null;
  const status = e.status === "entered_in_error" ? "entered-in-error" : (received ?? "unknown");
  return compact<MedicationStatement>({
    resourceType: "MedicationStatement",
    id: e.id,
    meta: meta(ctx, e),
    status: status as MedicationStatement["status"],
    medicationCodeableConcept: code(e),
    subject: ref("Patient", patientId),
    effectiveDateTime: isDateTime(e.effectiveText) ? e.effectiveText : undefined,
    dosage: e.valueText ? [{ text: e.valueText }] : undefined,
    note: notes(
      e.category === "prescribed_elsewhere" && "Prescribed elsewhere (received as a MedicationRequest; not a prescription of this organization).",
      e.statusText && !received && `Status at the source: ${e.statusText}`,
      e.effectiveText && !isDateTime(e.effectiveText) && `Date at the source: ${e.effectiveText}`,
    ),
  });
}

const DOCUMENT_STATUS = new Set(["current", "superseded", "entered-in-error"]);

/**
 * A document described by another system: its metadata only. The file was neither fetched nor stored, so the
 * attachment has no URL or data; this organization is not its custodian.
 */
export function toExternalDocumentReference(ctx: FhirContext, patientId: string, e: ExternalHistorySource): DocumentReference {
  const status = e.status === "entered_in_error" ? "entered-in-error" : e.statusText && DOCUMENT_STATUS.has(e.statusText) ? e.statusText : "current";
  return compact<DocumentReference>({
    resourceType: "DocumentReference",
    id: e.id,
    meta: meta(ctx, e),
    status: status as DocumentReference["status"],
    type: e.category ? text(e.category) : undefined,
    subject: ref("Patient", patientId),
    date: e.effectiveText && INSTANT.test(e.effectiveText) ? e.effectiveText : undefined,
    description: e.display,
    content: [{ attachment: { title: e.valueText ?? "File not imported" } }],
  });
}

/** One external history entry as the most faithful R4 resource for its kind. */
export function toExternalHistoryResource(ctx: FhirContext, patientId: string, e: ExternalHistorySource) {
  switch (e.kind) {
    case "condition":
      return toExternalCondition(ctx, patientId, e);
    case "observation":
      return toExternalObservation(ctx, patientId, e);
    case "medication":
      return toExternalMedicationStatement(ctx, patientId, e);
    case "document":
      return toExternalDocumentReference(ctx, patientId, e);
  }
}
