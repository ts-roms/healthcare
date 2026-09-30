import { SYSTEMS } from "../fhir/terminology";
import {
  type ExternalHistoryInput,
  type ImportedAddress,
  type ImportedAllergy,
  type ImportedAllergyInput,
  type ImportedCode,
  type ImportedCondition,
  type ImportedDocument,
  type ImportedFamilyHistory,
  type ImportedFamilyHistoryInput,
  type ImportedImmunization,
  type ImportedImmunizationInput,
  type ImportedItem,
  type ImportedMedication,
  type ImportedObservation,
  type ImportedPastProcedureInput,
  type ImportedPatient,
  type ImportedProcedure,
  type SubjectMatch,
} from "./inbound-model";
import type {
  InboundAllergy,
  InboundCodeableConcept,
  InboundCondition,
  InboundDocumentReference,
  InboundFamilyMemberHistory,
  InboundImmunization,
  InboundMedicationRequest,
  InboundMedicationStatement,
  InboundObservation,
  InboundPatient,
  InboundProcedure,
  InboundQuantity,
  InboundReference,
  ParsedEntry,
  ParsedImport,
} from "./inbound-validation";
import type { RegistrationDraft } from "./ports";

/**
 * Inbound mappers: validated FHIR R4 resources → the platform's format-neutral import model (inbound-model.ts).
 * Pure functions, separate from the export mappers. National identifier systems are recognised only when configured
 * (FHIR_IDENTIFIER_SYSTEMS); nothing is guessed.
 */

export interface InboundContext {
  /** Internal identifier type → configured system URI (FhirContext.identifierSystems). */
  identifierSystems?: Partial<Record<string, string>>;
}

/** The import's patient: the bundle's one Patient resource, if any. */
export interface ImportPatientRef {
  fullUrl: string | null;
  id: string | null;
}

const MAX_TEXT = 500;

function clip(value: string | null | undefined, max = MAX_TEXT): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function codesOf(concept: InboundCodeableConcept | undefined): ImportedCode[] {
  return (concept?.coding ?? []).map((c) => ({ system: c.system ?? null, code: c.code ?? null, display: c.display ?? null }));
}

/** Human text of a CodeableConcept: its text, else the first coding's display, else its code. */
export function conceptText(concept: InboundCodeableConcept | undefined): string | null {
  if (!concept) return null;
  if (concept.text) return concept.text;
  const coding = concept.coding ?? [];
  return coding.find((c) => c.display)?.display ?? coding.find((c) => c.code)?.code ?? null;
}

/** The code of the first coding (optionally of a system), e.g. a clinical status. */
function statusCode(concept: InboundCodeableConcept | undefined, system?: string): string | null {
  const coding = concept?.coding ?? [];
  return (system ? coding.find((c) => c.system === system && c.code) : undefined)?.code ?? coding.find((c) => c.code)?.code ?? concept?.text ?? null;
}

function quantityText(q: InboundQuantity | undefined): string | null {
  if (!q || q.value === undefined) return null;
  return `${q.comparator ?? ""}${q.value}${q.unit || q.code ? ` ${q.unit ?? q.code}` : ""}`;
}

interface ValueCarrier {
  valueQuantity?: InboundQuantity;
  valueCodeableConcept?: InboundCodeableConcept;
  valueString?: string;
  valueBoolean?: boolean;
  valueInteger?: number;
  valueRange?: { low?: InboundQuantity; high?: InboundQuantity };
  valueRatio?: { numerator?: InboundQuantity; denominator?: InboundQuantity };
  valueDateTime?: string;
}

function valueText(v: ValueCarrier): string | null {
  if (v.valueQuantity) return quantityText(v.valueQuantity);
  if (v.valueCodeableConcept) return conceptText(v.valueCodeableConcept);
  if (v.valueString !== undefined) return v.valueString;
  if (v.valueBoolean !== undefined) return v.valueBoolean ? "Yes" : "No";
  if (v.valueInteger !== undefined) return String(v.valueInteger);
  if (v.valueRange) return `${quantityText(v.valueRange.low) ?? "…"} – ${quantityText(v.valueRange.high) ?? "…"}`;
  if (v.valueRatio) return `${quantityText(v.valueRatio.numerator) ?? "?"} / ${quantityText(v.valueRatio.denominator) ?? "?"}`;
  if (v.valueDateTime) return v.valueDateTime;
  return null;
}

/** Does a subject reference point at the import's Patient? */
export function subjectMatch(ref: InboundReference | undefined, patient: ImportPatientRef | null): SubjectMatch {
  const target = ref?.reference;
  if (!target || !patient) return "not_stated";
  if (patient.fullUrl && target === patient.fullUrl) return "import_patient";
  if (patient.id && (target === `Patient/${patient.id}` || target.endsWith(`/Patient/${patient.id}`))) return "import_patient";
  return "other_patient";
}

function subjectNotes(subject: SubjectMatch): { acceptable: boolean; notes: string[] } {
  if (subject === "other_patient") return { acceptable: false, notes: ["Refers to a different patient than the one in this import: cannot be accepted."] };
  if (subject === "not_stated")
    return { acceptable: true, notes: ["The sender did not link it to the patient in this import; check it belongs to the matched patient."] };
  return { acceptable: true, notes: [] };
}

// ---- Patient -----------------------------------------------------------------------------------------------------

export function mapPatient(ctx: InboundContext, r: InboundPatient): ImportedPatient {
  const name = r.name?.find((n) => n.use === "official") ?? r.name?.find((n) => n.use !== "old" && n.use !== "maiden") ?? r.name?.[0];
  const typesBySystem = new Map(Object.entries(ctx.identifierSystems ?? {}).flatMap(([type, system]) => (system ? [[system, type] as const] : [])));
  const notes: string[] = [];
  const sex = r.gender === "male" || r.gender === "female" || r.gender === "unknown" ? r.gender : null;
  if (r.gender === "other") notes.push('Gender "other" has no single equivalent in the platform: choose the sex at registration.');
  const deceased = r.deceasedBoolean === true || r.deceasedDateTime !== undefined;
  if (deceased) notes.push("The sender records the patient as deceased.");
  const familyName = clip(name?.family, 100);
  const givenNames = (name?.given ?? []).map((g) => clip(g, 100)).filter((g): g is string => Boolean(g));
  if (!familyName || givenNames.length === 0 || !r.birthDate || r.birthDate.length !== 10 || !sex) {
    notes.push("Name, full birth date or sex is missing: match an existing patient, or register through the registration form.");
  }
  return {
    kind: "patient",
    resourceType: "Patient",
    acceptable: true,
    notes,
    familyName,
    givenNames,
    nameText: clip(name?.text, 200),
    suffix: clip(name?.suffix?.join(" "), 20),
    sex,
    gender: r.gender ?? null,
    birthDate: r.birthDate ?? null,
    deceased,
    identifiers: (r.identifier ?? [])
      .filter((i) => i.value)
      .map((i) => ({ system: i.system ?? null, value: clip(i.value, 64)!, type: (i.system && typesBySystem.get(i.system)) || null })),
    telecom: (r.telecom ?? []).filter((t) => t.value).map((t) => ({ system: t.system ?? null, value: clip(t.value, 254)!, use: t.use ?? null })),
    addresses: (r.address ?? []).map((a): ImportedAddress => ({
      use: a.use ?? null,
      lines: (a.line ?? []).map((l) => clip(l, 300)!).filter(Boolean),
      city: clip(a.city, 120),
      district: clip(a.district, 120),
      state: clip(a.state, 120),
      postalCode: clip(a.postalCode, 20),
      country: clip(a.country, 60),
      text: clip(a.text, 300),
    })),
  };
}

// ---- AllergyIntolerance ------------------------------------------------------------------------------------------

/** Codes that state an absence of allergies ("no known allergy"): the platform records that only as its own review. */
const NO_ALLERGY_CODES = new Set(["716186003", "409137002", "428607008", "429625007"]);

export function mapAllergy(r: InboundAllergy, patient: ImportPatientRef | null): ImportedAllergy {
  const subject = subjectMatch(r.patient, patient);
  const { acceptable: subjectOk, notes } = subjectNotes(subject);
  let acceptable = subjectOk;
  const clinicalStatus = statusCode(r.clinicalStatus, SYSTEMS.allergyClinical);
  const verificationStatus = statusCode(r.verificationStatus, SYSTEMS.allergyVerification);
  const substance = clip(conceptText(r.code) ?? conceptText(r.reaction?.find((x) => x.substance)?.substance), 200);
  const statesNone = (r.code?.coding ?? []).some((c) => c.system === SYSTEMS.snomed && c.code && NO_ALLERGY_CODES.has(c.code));
  if (statesNone) {
    acceptable = false;
    notes.push('States "no known allergies": the platform records that only when staff review allergies with the patient.');
  } else if (!substance) {
    acceptable = false;
    notes.push("No substance is given.");
  }
  if (verificationStatus === "entered-in-error" || verificationStatus === "refuted") {
    acceptable = false;
    notes.push(`Marked ${verificationStatus} by the sender.`);
  }
  if (clinicalStatus === "inactive" || clinicalStatus === "resolved") {
    acceptable = false;
    notes.push(`The sender records it as ${clinicalStatus}: it is not added to the active allergy list.`);
  }
  const severities = (r.reaction ?? []).map((x) => x.severity).filter(Boolean);
  const severity = severities.includes("severe") ? "severe" : severities.includes("moderate") ? "moderate" : severities.includes("mild") ? "mild" : null;
  const category = r.category?.[0] ?? "other";
  const reaction = clip(
    (r.reaction ?? [])
      .flatMap((x) => [...x.manifestation.map((m) => conceptText(m)), x.description ?? null])
      .filter((t): t is string => Boolean(t))
      .join("; "),
  );
  return {
    kind: "allergy",
    resourceType: "AllergyIntolerance",
    acceptable,
    notes,
    subject,
    substance,
    codes: codesOf(r.code),
    category,
    criticality: r.criticality === "unable-to-assess" || !r.criticality ? "unable_to_assess" : r.criticality,
    severity,
    reaction,
    clinicalStatus,
    verificationStatus,
    recordedDate: r.recordedDate ?? null,
  };
}

// ---- Condition ---------------------------------------------------------------------------------------------------

export function mapCondition(r: InboundCondition, patient: ImportPatientRef | null): ImportedCondition {
  const subject = subjectMatch(r.subject, patient);
  const { acceptable: subjectOk, notes } = subjectNotes(subject);
  let acceptable = subjectOk;
  const display = clip(conceptText(r.code));
  const verificationStatus = statusCode(r.verificationStatus, SYSTEMS.conditionVerification);
  if (!display) {
    acceptable = false;
    notes.push("No condition is named.");
  }
  if (verificationStatus === "entered-in-error" || verificationStatus === "refuted") {
    acceptable = false;
    notes.push(`Marked ${verificationStatus} by the sender.`);
  }
  return {
    kind: "condition",
    resourceType: "Condition",
    acceptable,
    notes,
    subject,
    display,
    codes: codesOf(r.code),
    category: clip(statusCode(r.category?.[0], SYSTEMS.conditionCategory), 60),
    clinicalStatus: statusCode(r.clinicalStatus, SYSTEMS.conditionClinical),
    verificationStatus,
    onset: r.onsetDateTime ?? r.onsetPeriod?.start ?? clip(r.onsetString, 60),
    abatement: r.abatementDateTime ?? clip(r.abatementString, 60),
    recordedDate: r.recordedDate ?? null,
  };
}

// ---- Observation -------------------------------------------------------------------------------------------------

export function mapObservation(r: InboundObservation, patient: ImportPatientRef | null): ImportedObservation {
  const subject = subjectMatch(r.subject, patient);
  const { acceptable: subjectOk, notes } = subjectNotes(subject);
  let acceptable = subjectOk;
  const categories = (r.category ?? []).flatMap((c) => (c.coding ?? []).map((x) => x.code));
  const category = categories.includes("laboratory") ? "laboratory" : categories.includes("vital-signs") ? "vital-signs" : "other";
  const components = (r.component ?? [])
    .map((c) => {
      const v = valueText(c);
      return v ? `${conceptText(c.code) ?? "Component"} ${v}` : null;
    })
    .filter((t): t is string => Boolean(t));
  const value = clip(valueText(r) ?? (components.length ? components.join("; ") : null));
  if (r.status === "entered-in-error" || r.status === "cancelled") {
    acceptable = false;
    notes.push(`The sender marks it ${r.status}.`);
  }
  if (r.status === "preliminary" || r.status === "registered") notes.push(`Not final at the source (${r.status}).`);
  const range = r.referenceRange?.[0];
  return {
    kind: "observation",
    resourceType: "Observation",
    acceptable,
    notes,
    subject,
    category,
    display: clip(conceptText(r.code)),
    codes: codesOf(r.code),
    value,
    interpretation: clip(
      (r.interpretation ?? [])
        .map((i) => conceptText(i))
        .filter(Boolean)
        .join(", "),
      120,
    ),
    referenceRange: range ? clip(range.text ?? `${quantityText(range.low) ?? "…"} – ${quantityText(range.high) ?? "…"}`, 120) : null,
    status: r.status,
    effective: r.effectiveDateTime ?? r.effectiveInstant ?? r.effectivePeriod?.start ?? r.issued ?? null,
  };
}

// ---- MedicationStatement / MedicationRequest ---------------------------------------------------------------------

export function mapMedication(r: InboundMedicationStatement | InboundMedicationRequest, patient: ImportPatientRef | null): ImportedMedication {
  const subject = subjectMatch(r.subject, patient);
  const { acceptable: subjectOk, notes } = subjectNotes(subject);
  let acceptable = subjectOk;
  const medication = clip(conceptText(r.medicationCodeableConcept) ?? r.medicationReference?.display ?? null);
  if (!medication) {
    acceptable = false;
    notes.push("The medication is given only by reference, without a name.");
  }
  if (r.status === "entered-in-error") {
    acceptable = false;
    notes.push("The sender marks it entered-in-error.");
  }
  const request = r.resourceType === "MedicationRequest";
  const dosages = request ? r.dosageInstruction : r.dosage;
  if (request) notes.push("Prescribed elsewhere: accepting records it as external medication history, not as a prescription.");
  return {
    kind: "medication",
    resourceType: r.resourceType,
    acceptable,
    notes,
    subject,
    statement: request ? "request" : "statement",
    medication,
    codes: codesOf(r.medicationCodeableConcept),
    dosage: clip(
      (dosages ?? [])
        .map((d) => d.text ?? d.patientInstruction)
        .filter(Boolean)
        .join("; "),
    ),
    status: r.status,
    date: request ? (r.authoredOn ?? null) : (r.effectiveDateTime ?? r.effectivePeriod?.start ?? r.dateAsserted ?? null),
  };
}

// ---- DocumentReference -------------------------------------------------------------------------------------------

export function mapDocument(r: InboundDocumentReference, patient: ImportPatientRef | null): ImportedDocument {
  const subject = subjectMatch(r.subject, patient);
  const { acceptable: subjectOk, notes } = subjectNotes(subject);
  let acceptable = subjectOk;
  if (r.status === "entered-in-error" || r.docStatus === "entered-in-error") {
    acceptable = false;
    notes.push("The sender marks it entered-in-error.");
  }
  notes.push("Only the description is imported: the file itself is neither fetched nor stored.");
  return {
    kind: "document",
    resourceType: "DocumentReference",
    acceptable,
    notes,
    subject,
    type: clip(conceptText(r.type) ?? conceptText(r.category?.[0]), 200),
    description: clip(r.description),
    status: r.status,
    date: r.date ?? null,
    attachments: r.content.map((c) => ({
      contentType: c.attachment.contentType ?? null,
      title: clip(c.attachment.title, 200),
      size: c.attachment.size ?? null,
      inline: c.attachment.data !== undefined,
      url: c.attachment.data === undefined ? clip(c.attachment.url, 300) : null,
    })),
  };
}

// ---- Immunization ------------------------------------------------------------------------------------------------

/** A FHIR dateTime the platform can record as a (possibly partial) date: YYYY, YYYY-MM, YYYY-MM-DD or an instant. */
const RECORDABLE_DATE_TIME = /^\d{4}(-\d{2}(-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2}))?)?)?$/;

export function mapImmunization(r: InboundImmunization, patient: ImportPatientRef | null): ImportedImmunization {
  const subject = subjectMatch(r.patient, patient);
  const { acceptable: subjectOk, notes } = subjectNotes(subject);
  let acceptable = subjectOk;
  const vaccine = clip(conceptText(r.vaccineCode), 200);
  if (!vaccine) {
    acceptable = false;
    notes.push("No vaccine is named.");
  }
  if (r.status === "entered-in-error") {
    acceptable = false;
    notes.push("The sender marks it entered-in-error.");
  }
  const fromText = r.occurrenceString && RECORDABLE_DATE_TIME.test(r.occurrenceString.trim()) ? r.occurrenceString.trim() : null;
  const occurrence = r.occurrenceDateTime ?? fromText;
  if (!occurrence) {
    acceptable = false;
    notes.push(`The date is given only as text ("${clip(r.occurrenceString, 60) ?? ""}"): record it as a reported dose instead.`);
  }
  if (r.status === "not-done") notes.push("Recorded by the sender as not given.");
  if (r.primarySource === false) notes.push("The sender did not give it: it was reported to them.");
  const dose = r.protocolApplied?.[0];
  const performer = r.performer?.find((p) => p.actor.display)?.actor.display ?? null;
  return {
    kind: "immunization",
    resourceType: "Immunization",
    acceptable,
    notes,
    subject,
    vaccine,
    codes: codesOf(r.vaccineCode),
    status: r.status,
    notDoneReason: clip(conceptText(r.statusReason), 500),
    occurrence,
    occurrenceText: occurrence ? null : clip(r.occurrenceString, 60),
    primarySource: r.primarySource ?? null,
    reportOrigin: clip(conceptText(r.reportOrigin), 200),
    lotNumber: clip(r.lotNumber, 60),
    expirationDate: r.expirationDate && /^\d{4}-\d{2}-\d{2}$/.test(r.expirationDate) ? r.expirationDate : null,
    site: clip(conceptText(r.site), 60),
    route: clip(conceptText(r.route), 60),
    doseQuantity:
      r.doseQuantity?.value !== undefined && r.doseQuantity.value > 0
        ? { value: r.doseQuantity.value, unit: clip(r.doseQuantity.unit ?? r.doseQuantity.code, 20) }
        : null,
    performer: clip(performer, 200),
    manufacturer: clip(r.manufacturer?.display, 200),
    doseNumber: dose ? clip(dose.doseNumberString ?? (dose.doseNumberPositiveInt !== undefined ? String(dose.doseNumberPositiveInt) : null), 60) : null,
    location: clip(r.location?.display, 200),
  };
}

// ---- Procedure ---------------------------------------------------------------------------------------------------

/** The date part of a FHIR dateTime (YYYY, YYYY-MM or YYYY-MM-DD as the sender wrote it), from 1900. */
function datePart(value: string | undefined): string | null {
  const m = value ? /^(\d{4}(-\d{2}(-\d{2})?)?)/.exec(value) : null;
  return m && Number(m[1]!.slice(0, 4)) >= 1900 ? m[1]! : null;
}

export function mapProcedure(r: InboundProcedure, patient: ImportPatientRef | null): ImportedProcedure {
  const subject = subjectMatch(r.subject, patient);
  const { acceptable: subjectOk, notes } = subjectNotes(subject);
  let acceptable = subjectOk;
  const display = clip(conceptText(r.code), 300);
  if (!display) {
    acceptable = false;
    notes.push("No procedure is named.");
  }
  if (r.status !== "completed") {
    acceptable = false;
    notes.push(`The sender records it as ${r.status}: only procedures that were done are added to the patient's history.`);
  }
  const performed = datePart(r.performedDateTime ?? r.performedPeriod?.start);
  const performedText =
    performed === null
      ? clip(
          r.performedString ?? (r.performedAge ? `at age ${quantityText(r.performedAge)}` : null) ?? (r.performedDateTime || r.performedPeriod?.start) ?? null,
          60,
        )
      : null;
  const performer = (r.performer ?? []).map((p) => p.actor.display).filter((d): d is string => Boolean(d));
  return {
    kind: "procedure",
    resourceType: "Procedure",
    acceptable,
    notes,
    subject,
    display,
    codes: codesOf(r.code),
    status: r.status,
    performed,
    performedText,
    performer: clip([...performer, r.location?.display].filter(Boolean).join(", "), 300),
    bodySite: clip(
      (r.bodySite ?? [])
        .map((b) => conceptText(b))
        .filter(Boolean)
        .join(", "),
      120,
    ),
    outcome: clip(conceptText(r.outcome), 200),
  };
}

// ---- FamilyMemberHistory -----------------------------------------------------------------------------------------

/** HL7 v3 RoleCode (FamilyMember value set) → the platform's relationship list; anything else is "other". */
const ROLE_RELATIONSHIPS: Record<string, string> = {
  MTH: "mother",
  NMTH: "mother",
  FTH: "father",
  NFTH: "father",
  SIS: "sister",
  NSIS: "sister",
  BRO: "brother",
  NBRO: "brother",
  SIB: "sibling",
  NSIB: "sibling",
  HSIB: "half_sibling",
  HSIS: "half_sibling",
  HBRO: "half_sibling",
  DAU: "daughter",
  DAUC: "daughter",
  SON: "son",
  SONC: "son",
  CHILD: "child",
  NCHILD: "child",
  MGRMTH: "maternal_grandmother",
  MGRFTH: "maternal_grandfather",
  PGRMTH: "paternal_grandmother",
  PGRFTH: "paternal_grandfather",
  MAUNT: "maternal_aunt",
  MUNCLE: "maternal_uncle",
  PAUNT: "paternal_aunt",
  PUNCLE: "paternal_uncle",
  COUSN: "cousin",
  MCOUSN: "cousin",
  PCOUSN: "cousin",
};

export function mapFamilyHistory(r: InboundFamilyMemberHistory, patient: ImportPatientRef | null): ImportedFamilyHistory {
  const subject = subjectMatch(r.patient, patient);
  const { acceptable: subjectOk, notes } = subjectNotes(subject);
  let acceptable = subjectOk;
  const roleCode = (r.relationship.coding ?? []).find((c) => c.system === SYSTEMS.v3RoleCode && c.code)?.code;
  const relationship = (roleCode && ROLE_RELATIONSHIPS[roleCode]) || "other";
  const relationshipText = clip(conceptText(r.relationship) ?? r.name, 100);
  const conditions = (r.condition ?? []).flatMap((c) => {
    const display = clip(conceptText(c.code), 300);
    if (!display) return [];
    const years =
      c.onsetAge && c.onsetAge.value !== undefined && (c.onsetAge.code === "a" || /^(a|y|yr|yrs|year|years)$/i.test(c.onsetAge.unit ?? ""))
        ? c.onsetAge.value
        : null;
    const onsetAge = years !== null && Number.isInteger(years) && years >= 0 && years <= 130 ? years : null;
    const onsetText =
      onsetAge === null
        ? clip(c.onsetString ?? (c.onsetAge ? quantityText(c.onsetAge) : null) ?? c.onsetPeriod?.start ?? (c.onsetRange ? "a range of ages" : null), 60)
        : null;
    return [{ display, codes: codesOf(c.code), onsetAge, onsetText, contributedToDeath: c.contributedToDeath === true }];
  });
  if (r.status === "entered-in-error") {
    acceptable = false;
    notes.push("The sender marks it entered-in-error.");
  }
  if (conditions.length === 0) {
    acceptable = false;
    notes.push(
      r.status === "health-unknown"
        ? "The sender says the relative's health is not known: record that as the family history review instead."
        : "No condition of the relative is named.",
    );
  }
  if (relationship === "other") notes.push(`The relationship is kept as written ("${relationshipText ?? "family member"}").`);
  const deceased = r.deceasedBoolean !== undefined ? r.deceasedBoolean : r.deceasedAge || r.deceasedRange || r.deceasedDate || r.deceasedString ? true : null;
  return {
    kind: "family_history",
    resourceType: "FamilyMemberHistory",
    acceptable,
    notes,
    subject,
    relationship,
    relationshipText,
    status: r.status,
    deceased,
    conditions,
  };
}

// ---- entries -----------------------------------------------------------------------------------------------------

/** The import's patient reference (its one Patient entry), for matching the subjects of the other entries. */
export function importPatientRef(entries: Array<Pick<ParsedEntry, "fullUrl" | "resource">>): ImportPatientRef | null {
  const p = entries.find((e) => e.resource.resourceType === "Patient");
  if (!p) return null;
  return { fullUrl: p.fullUrl, id: typeof p.resource["id"] === "string" ? p.resource["id"] : null };
}

/** Maps one validated resource (parseImport has checked it) to the import model. */
export function mapInboundResource(ctx: InboundContext, resource: ParsedEntry["resource"], patient: ImportPatientRef | null): ImportedItem {
  switch (resource.resourceType) {
    case "Patient":
      return mapPatient(ctx, resource as unknown as InboundPatient);
    case "AllergyIntolerance":
      return mapAllergy(resource as unknown as InboundAllergy, patient);
    case "Condition":
      return mapCondition(resource as unknown as InboundCondition, patient);
    case "Observation":
      return mapObservation(resource as unknown as InboundObservation, patient);
    case "MedicationStatement":
    case "MedicationRequest":
      return mapMedication(resource as unknown as InboundMedicationStatement | InboundMedicationRequest, patient);
    case "DocumentReference":
      return mapDocument(resource as unknown as InboundDocumentReference, patient);
    case "Immunization":
      return mapImmunization(resource as unknown as InboundImmunization, patient);
    case "Procedure":
      return mapProcedure(resource as unknown as InboundProcedure, patient);
    case "FamilyMemberHistory":
      return mapFamilyHistory(resource as unknown as InboundFamilyMemberHistory, patient);
    default:
      return {
        kind: "not_supported",
        resourceType: resource.resourceType,
        acceptable: false,
        notes: [`${resource.resourceType} is not supported for import.`],
      };
  }
}

/** Maps every entry of a parsed import, in order. */
export function mapInboundEntries(ctx: InboundContext, parsed: Pick<ParsedImport, "entries">): ImportedItem[] {
  const patient = importPatientRef(parsed.entries);
  return parsed.entries.map((e) => mapInboundResource(ctx, e.resource, patient));
}

// ---- what an accepted entry becomes ------------------------------------------------------------------------------

function firstCode(codes: ImportedCode[]): { codeSystem: string | null; code: string | null } {
  const coded = codes.find((c) => c.system && c.code) ?? codes.find((c) => c.code);
  return { codeSystem: clip(coded?.system, 200), code: clip(coded?.code, 60) };
}

/** The clinic allergy an accepted AllergyIntolerance becomes (unconfirmed: nobody here verified it). */
export function toAllergyInput(item: ImportedAllergy): ImportedAllergyInput {
  if (!item.substance) throw new Error("An allergy without a substance cannot be recorded");
  return {
    category: item.category,
    substance: item.substance,
    ...(item.reaction ? { reaction: item.reaction } : {}),
    ...(item.severity ? { severity: item.severity } : {}),
    criticality: item.criticality,
  };
}

/** The external history entry a Condition, Observation, medication or DocumentReference becomes on accept. */
export function toExternalHistory(item: ImportedCondition | ImportedObservation | ImportedMedication | ImportedDocument): ExternalHistoryInput {
  switch (item.kind) {
    case "condition":
      return {
        kind: "condition",
        category: item.category,
        display: item.display ?? "Condition",
        ...firstCode(item.codes),
        valueText: item.abatement ? `Abated ${item.abatement}` : null,
        statusText: clip([item.clinicalStatus, item.verificationStatus].filter(Boolean).join(" · "), 120),
        effectiveText: clip(item.onset ?? item.recordedDate, 60),
      };
    case "observation":
      return {
        kind: "observation",
        category: item.category,
        display: item.display ?? "Observation",
        ...firstCode(item.codes),
        valueText: clip(
          [item.value, item.interpretation ? `(${item.interpretation})` : null, item.referenceRange ? `ref. ${item.referenceRange}` : null]
            .filter(Boolean)
            .join(" "),
        ),
        statusText: item.status,
        effectiveText: clip(item.effective, 60),
      };
    case "medication":
      return {
        kind: "medication",
        category: item.statement === "request" ? "prescribed_elsewhere" : "reported",
        display: item.medication ?? "Medication",
        ...firstCode(item.codes),
        valueText: item.dosage,
        statusText: item.status,
        effectiveText: clip(item.date, 60),
      };
    case "document":
      return {
        kind: "document",
        category: item.type,
        display: item.description ?? item.type ?? "Document",
        codeSystem: null,
        code: null,
        valueText: clip(
          item.attachments
            .map((a) => [a.title, a.contentType, a.size !== null ? `${Math.max(1, Math.round(a.size / 1024))} KB` : null].filter(Boolean).join(", "))
            .filter(Boolean)
            .join("; ")
            .concat(" (file not imported)"),
        ),
        statusText: item.status,
        effectiveText: clip(item.date, 60),
      };
  }
}

/**
 * The immunization record an accepted Immunization becomes: the vaccine as named and coded by the sender, the date at
 * the precision received, and where the information comes from (the sender's own record, or reported to it).
 */
export function toImmunizationInput(item: ImportedImmunization): ImportedImmunizationInput {
  if (!item.vaccine || !item.occurrence) throw new Error("An immunization without a vaccine or a date cannot be recorded");
  const coded = firstCode(item.codes);
  const numeric = item.doseNumber && /^\d{1,2}$/.test(item.doseNumber) ? Number(item.doseNumber) : null;
  const unit = item.doseQuantity?.unit ?? null;
  return {
    vaccineName: item.vaccine,
    vaccineCodeSystem: coded.code ? coded.codeSystem : null,
    vaccineCode: coded.code,
    manufacturer: item.manufacturer,
    status: item.status === "not-done" ? "not_done" : "completed",
    notDoneReasonText: item.status === "not-done" ? item.notDoneReason : null,
    occurrence: item.occurrence,
    doseLabel: item.doseNumber,
    doseNumber: numeric !== null && numeric >= 1 && numeric <= 50 ? numeric : null,
    lotNumber: item.lotNumber,
    expiryDate: item.expirationDate,
    route: item.route,
    site: item.site,
    doseQuantity: item.doseQuantity && unit ? item.doseQuantity.value : null,
    doseUnit: item.doseQuantity && unit ? unit : null,
    performerName: clip([item.performer, item.location].filter(Boolean).join(", "), 200),
    sourceDescription: clip(
      item.primarySource === false ? `Reported to the sender${item.reportOrigin ? ` (${item.reportOrigin})` : ""}` : "Recorded by the sender",
      300,
    ),
  };
}

/**
 * The past procedure an accepted Procedure becomes: the procedure as named and coded by the sender, the date part of
 * what was sent (a date given only as text, an age or the outcome kept as a note), and who did it.
 */
export function toPastProcedureInput(item: ImportedProcedure): ImportedPastProcedureInput {
  if (!item.display) throw new Error("A procedure without a name cannot be recorded");
  const coded = firstCode(item.codes);
  return {
    description: item.display,
    codeSystem: coded.code ? coded.codeSystem : null,
    code: coded.code,
    performed: item.performed,
    performer: item.performer,
    bodySite: item.bodySite,
    notes: clip(
      [item.performedText ? `Date at the source: ${item.performedText}` : null, item.outcome ? `Outcome: ${item.outcome}` : null].filter(Boolean).join(". "),
      2000,
    ),
    sourceDescription: "Recorded by the sender",
  };
}

/**
 * The family history entries an accepted FamilyMemberHistory becomes: one per condition of the relative; a condition
 * that contributed to death is also its cause of death.
 */
export function toFamilyHistoryInputs(item: ImportedFamilyHistory): ImportedFamilyHistoryInput[] {
  if (item.conditions.length === 0) throw new Error("A family member history without a condition cannot be recorded");
  return item.conditions.map((c) => {
    const coded = firstCode(c.codes);
    const deceased = c.contributedToDeath ? true : item.deceased;
    return {
      relationship: item.relationship,
      relationshipText: item.relationship === "other" ? (item.relationshipText ?? "Family member") : null,
      condition: c.display,
      codeSystem: coded.code ? coded.codeSystem : null,
      code: coded.code,
      onsetAge: c.onsetAge,
      deceased,
      causeOfDeath: c.contributedToDeath ? clip(c.display, 300) : null,
      notes: c.onsetText ? `Onset at the source: ${c.onsetText}` : null,
    };
  });
}

/**
 * What registering a new patient from the imported Patient would record (before the patient domain's own checks):
 * undefined when name, full birth date or sex is missing. Given names are kept together as the given name (FHIR does
 * not say which one, if any, is a Philippine middle name). Only identifiers of configured systems are carried over.
 */
export function registrationDraft(p: ImportedPatient): RegistrationDraft | undefined {
  if (!p.familyName || p.givenNames.length === 0 || !p.sex || !p.birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(p.birthDate)) return undefined;
  const contacts = p.telecom.flatMap((t): RegistrationDraft["contacts"] => {
    if (t.system === "email") return [{ system: "email", value: t.value }];
    if (t.system === "sms" || (t.system === "phone" && t.use === "mobile")) return [{ system: "mobile", value: t.value }];
    if (t.system === "phone") return [{ system: "phone", value: t.value }];
    return [];
  });
  const addresses = p.addresses.flatMap((a): RegistrationDraft["addresses"] =>
    a.city
      ? [
          {
            cityMunicipality: a.city,
            ...(a.lines[0] ? { line1: a.lines[0] } : {}),
            ...(a.district ? { province: a.district } : {}),
            ...(a.state ? { region: a.state } : {}),
            ...(a.postalCode && /^\d{4}$/.test(a.postalCode) ? { postalCode: a.postalCode } : {}),
          },
        ]
      : [],
  );
  return {
    familyName: p.familyName,
    givenName: p.givenNames.join(" ").slice(0, 100),
    ...(p.suffix ? { suffix: p.suffix } : {}),
    sex: p.sex,
    birthDate: p.birthDate,
    contacts: contacts.slice(0, 10),
    addresses: addresses.slice(0, 5),
    identifiers: p.identifiers.flatMap((i) => (i.type ? [{ type: i.type, value: i.value }] : [])).slice(0, 10),
  };
}
