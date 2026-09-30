import type { CodeableConcept, Coding, Condition, FamilyMemberHistory, Meta, Observation, Procedure, Reference } from "fhir/r4";
import type {
  FamilyHistorySource,
  FhirContext,
  HistoryInformant,
  PastConditionSource,
  PastProcedureSource,
  PatientHistorySource,
  SocialHistorySource,
} from "./sources";
import { codeSystem, compact, concept, externalMeta, localSystem, ref, text } from "./support";
import { SYSTEMS } from "./terminology";

/**
 * The patient history (docs/domains/patient-history.md) as FHIR R4:
 *
 * - past procedures → `Procedure` (status completed; `performedDateTime` at the precision known; category a local
 *   "past procedure" code so they are not taken for procedures of the organization);
 * - past conditions → `Condition` with a local category "past medical history (as reported)" and verificationStatus
 *   `unconfirmed` — deliberately not `problem-list-item` (the problem list is the diagnoses of consultations) nor
 *   `encounter-diagnosis`;
 * - family history → `FamilyMemberHistory` (relationship coded in HL7 v3 RoleCode; a cause of death as a condition
 *   that contributed to death);
 * - social history → one `Observation` per part of each version (category `social-history`; local codes and values:
 *   no LOINC or SNOMED CT code is assumed; entries in error `entered-in-error`). Substance use and sexual history only
 *   for a caller who may see them.
 *
 * Who told the organization is the `asserter` (the patient, or a relative or another provider as display text); the
 * clinician who recorded it, when a practitioner, the `recorder`. Reported entries carry the `record-source#reported`
 * tag, imported ones the external-import tag. Staff notes are not exported.
 */

/** HL7 v3 RoleCode (the FamilyMember value set) for the platform's relationship list. */
const ROLE_CODES: Record<string, { code: string; display: string }> = {
  mother: { code: "MTH", display: "mother" },
  father: { code: "FTH", display: "father" },
  sister: { code: "SIS", display: "sister" },
  brother: { code: "BRO", display: "brother" },
  sibling: { code: "SIB", display: "sibling" },
  half_sibling: { code: "HSIB", display: "half-sibling" },
  daughter: { code: "DAUC", display: "daughter" },
  son: { code: "SONC", display: "son" },
  child: { code: "CHILD", display: "child" },
  maternal_grandmother: { code: "MGRMTH", display: "maternal grandmother" },
  maternal_grandfather: { code: "MGRFTH", display: "maternal grandfather" },
  paternal_grandmother: { code: "PGRMTH", display: "paternal grandmother" },
  paternal_grandfather: { code: "PGRFTH", display: "paternal grandfather" },
  maternal_aunt: { code: "MAUNT", display: "maternal aunt" },
  maternal_uncle: { code: "MUNCLE", display: "maternal uncle" },
  paternal_aunt: { code: "PAUNT", display: "paternal aunt" },
  paternal_uncle: { code: "PUNCLE", display: "paternal uncle" },
  cousin: { code: "COUSN", display: "cousin" },
  other: { code: "FAMMEMB", display: "family member" },
};

const RELATIONSHIP_TEXT: Record<string, string> = {
  mother: "Mother",
  father: "Father",
  sister: "Sister",
  brother: "Brother",
  sibling: "Sibling",
  half_sibling: "Half-sibling",
  daughter: "Daughter",
  son: "Son",
  child: "Child",
  maternal_grandmother: "Maternal grandmother",
  maternal_grandfather: "Maternal grandfather",
  paternal_grandmother: "Paternal grandmother",
  paternal_grandfather: "Paternal grandfather",
  maternal_aunt: "Maternal aunt",
  maternal_uncle: "Maternal uncle",
  paternal_aunt: "Paternal aunt",
  paternal_uncle: "Paternal uncle",
  cousin: "Cousin",
  other: "Family member",
};

const ABSOLUTE_URI = /^[A-Za-z][A-Za-z0-9+.-]*:\S+$/;

/** The platform's `record-source#reported` tag: told to the organization by the patient, a relative or another provider. */
export function reportedSourceTag(ctx: FhirContext): Coding {
  return { system: localSystem(ctx, "codesystem/record-source"), code: "reported", display: "Reported to this organization" };
}

function historyMeta(ctx: FhirContext, e: { source: string; recordedAt: string; enteredInErrorAt: string | null; declaredSource?: string | null }): Meta {
  // Reliable: a history row changes only when marked entered in error (database trigger).
  const lastUpdated = e.enteredInErrorAt ?? e.recordedAt;
  if (e.source === "external_import") return externalMeta(ctx, { lastUpdated, declaredSource: e.declaredSource ?? null });
  if (e.source === "reported") return { lastUpdated, tag: [reportedSourceTag(ctx)] };
  return { lastUpdated };
}

/** The code as recorded: an organization key (its configured or local system) or, for an import, the URI as received. */
function coded(ctx: FhirContext, e: { source: string; codeSystem: string | null; code: string | null }, display: string): CodeableConcept {
  if (!e.code || !e.codeSystem) return text(display);
  const system = e.source === "external_import" ? (ABSOLUTE_URI.test(e.codeSystem) ? e.codeSystem : undefined) : codeSystem(ctx, e.codeSystem);
  return { coding: [compact<Coding>({ system, code: e.code, display })], text: display };
}

/** A partial date at its precision, as an R4 dateTime (YYYY, YYYY-MM or YYYY-MM-DD). */
export function partialDateTime(date: string | null, precision: "year" | "month" | "day" | null): string | undefined {
  if (!date || !precision) return undefined;
  return precision === "year" ? date.slice(0, 4) : precision === "month" ? date.slice(0, 7) : date;
}

const INFORMANT: Record<HistoryInformant, string> = {
  patient: "The patient",
  relative: "A relative of the patient",
  other_provider: "Another healthcare provider",
};

function asserter(patientId: string, e: { source: string; reportedBy: HistoryInformant | null; recorderPractitionerId: string | null }): Reference | undefined {
  if (e.source === "reported" && e.reportedBy) return e.reportedBy === "patient" ? ref("Patient", patientId) : { display: INFORMANT[e.reportedBy] };
  if (e.source === "recorded_here" && e.recorderPractitionerId) return ref("Practitioner", e.recorderPractitionerId);
  return undefined;
}

function historyCategory(ctx: FhirContext, code: string, display: string): CodeableConcept {
  return concept({ system: localSystem(ctx, "codesystem/history-category"), code, display }, display);
}

export function toPastProcedure(ctx: FhirContext, patientId: string, p: PastProcedureSource): Procedure {
  return compact<Procedure>({
    resourceType: "Procedure",
    id: p.id,
    meta: historyMeta(ctx, p),
    status: p.enteredInErrorAt ? "entered-in-error" : "completed",
    category: historyCategory(ctx, "past-procedure", "Past procedure (history)"),
    code: coded(ctx, p, p.description),
    subject: ref("Patient", patientId),
    performedDateTime: partialDateTime(p.performedDate, p.performedPrecision),
    recorder: p.recorderPractitionerId ? ref("Practitioner", p.recorderPractitionerId) : undefined,
    asserter: asserter(patientId, p),
    performer: p.performer ? [{ actor: { display: p.performer } }] : undefined,
    bodySite: p.bodySite ? [text(p.bodySite)] : undefined,
    note: p.sourceDescription ? [{ text: `Source: ${p.sourceDescription}` }] : undefined,
  });
}

export function toPastCondition(ctx: FhirContext, patientId: string, c: PastConditionSource): Condition {
  const inError = c.enteredInErrorAt !== null;
  return compact<Condition>({
    resourceType: "Condition",
    id: c.id,
    meta: historyMeta(ctx, c),
    // con-5: no clinical status when entered in error; "unknown" as reported has no clinical status.
    clinicalStatus: !inError && c.reportedStatus !== "unknown" ? concept({ system: SYSTEMS.conditionClinical, code: c.reportedStatus }) : undefined,
    verificationStatus: concept({ system: SYSTEMS.conditionVerification, code: inError ? "entered-in-error" : "unconfirmed" }),
    category: [historyCategory(ctx, "past-medical-history", "Past medical history (as reported)")],
    code: coded(ctx, c, c.description),
    subject: ref("Patient", patientId),
    onsetDateTime: partialDateTime(c.onsetDate, c.onsetPrecision),
    recordedDate: c.recordedAt,
    recorder: c.recorderPractitionerId ? ref("Practitioner", c.recorderPractitionerId) : undefined,
    asserter: asserter(patientId, c),
    note: [
      { text: "A past condition as reported to this organization; not a diagnosis made here." },
      ...(c.diagnosedBy ? [{ text: `Diagnosed or treated at: ${c.diagnosedBy}` }] : []),
      ...(c.sourceDescription ? [{ text: `Source: ${c.sourceDescription}` }] : []),
    ],
  });
}

export function toFamilyMemberHistory(ctx: FhirContext, patientId: string, f: FamilyHistorySource): FamilyMemberHistory {
  const role = ROLE_CODES[f.relationship] ?? ROLE_CODES["other"]!;
  const label = f.relationship === "other" ? (f.relationshipText ?? RELATIONSHIP_TEXT["other"]!) : RELATIONSHIP_TEXT[f.relationship]!;
  const relationshipText = f.relationship !== "other" && f.relationshipText ? `${label} (${f.relationshipText})` : label;
  return compact<FamilyMemberHistory>({
    resourceType: "FamilyMemberHistory",
    id: f.id,
    meta: historyMeta(ctx, f),
    status: f.enteredInErrorAt ? "entered-in-error" : "completed",
    patient: ref("Patient", patientId),
    date: f.recordedAt,
    relationship: concept({ system: SYSTEMS.v3RoleCode, code: role.code, display: role.display }, relationshipText),
    deceasedBoolean: f.deceased ?? undefined,
    condition: [
      compact({
        code: coded(ctx, f, f.condition),
        onsetAge: f.onsetAge !== null ? { value: f.onsetAge, unit: "years", system: SYSTEMS.ucum, code: "a" } : undefined,
      }),
      ...(f.deceased && f.causeOfDeath ? [{ code: text(f.causeOfDeath), contributedToDeath: true }] : []),
    ],
  });
}

const USE_STATUS_TEXT: Record<string, string> = { never: "Never", former: "Former", current: "Current", unknown: "Not known" };

/** The parts of a social history version, each an Observation (local code; sensitive parts marked). */
const SOCIAL_PARTS = [
  { key: "tobacco", display: "Tobacco use", sensitive: false },
  { key: "alcohol", display: "Alcohol use", sensitive: false },
  { key: "substance-use", display: "Other substance use", sensitive: true },
  { key: "occupation", display: "Occupation", sensitive: false },
  { key: "occupational-exposure", display: "Occupational exposures", sensitive: false },
  { key: "living-situation", display: "Living situation", sensitive: false },
  { key: "physical-activity", display: "Physical activity", sensitive: false },
  { key: "diet", display: "Diet", sensitive: false },
  { key: "sexual-history", display: "Sexual history", sensitive: true },
] as const;

function socialValue(s: SocialHistorySource, key: (typeof SOCIAL_PARTS)[number]["key"]): { status?: string; text: string } | null {
  switch (key) {
    case "tobacco": {
      if (!s.tobaccoStatus) return null;
      const details = [s.tobaccoType, s.tobaccoAmount, s.tobaccoQuitYear ? `quit ${s.tobaccoQuitYear}` : null].filter(Boolean);
      return { status: s.tobaccoStatus, text: [USE_STATUS_TEXT[s.tobaccoStatus], details.join(", ")].filter(Boolean).join(" — ") };
    }
    case "alcohol":
      if (!s.alcoholStatus) return null;
      return { status: s.alcoholStatus, text: [USE_STATUS_TEXT[s.alcoholStatus], s.alcoholFrequency].filter(Boolean).join(" — ") };
    case "substance-use":
      return s.substanceUse ? { text: s.substanceUse } : null;
    case "occupation":
      return s.occupation ? { text: s.occupation } : null;
    case "occupational-exposure":
      return s.occupationalExposures ? { text: s.occupationalExposures } : null;
    case "living-situation":
      return s.livingSituation ? { text: s.livingSituation } : null;
    case "physical-activity":
      return s.physicalActivity ? { text: s.physicalActivity } : null;
    case "diet":
      return s.diet ? { text: s.diet } : null;
    case "sexual-history":
      return s.sexualHistory ? { text: s.sexualHistory } : null;
  }
}

/** One version of the social history as Observations (sensitive parts only when `includeSensitive`). */
export function toSocialHistoryObservations(ctx: FhirContext, patientId: string, s: SocialHistorySource, includeSensitive: boolean): Observation[] {
  const out: Observation[] = [];
  for (const part of SOCIAL_PARTS) {
    if (part.sensitive && !includeSensitive) continue;
    const value = socialValue(s, part.key);
    if (!value) continue;
    out.push(
      compact<Observation>({
        resourceType: "Observation",
        id: `${s.id}-${part.key}`,
        meta: { lastUpdated: s.enteredInErrorAt ?? s.recordedAt },
        status: s.enteredInErrorAt ? "entered-in-error" : "final",
        category: [concept({ system: SYSTEMS.observationCategory, code: "social-history", display: "Social History" })],
        code: concept({ system: localSystem(ctx, "codesystem/social-history"), code: part.key, display: part.display }, part.display),
        subject: ref("Patient", patientId),
        effectiveDateTime: s.effectiveDate,
        issued: s.recordedAt,
        valueCodeableConcept: value.status
          ? concept({ system: localSystem(ctx, "codesystem/use-status"), code: value.status, display: USE_STATUS_TEXT[value.status] }, value.text)
          : undefined,
        valueString: value.status ? undefined : value.text,
      }),
    );
  }
  return out;
}

/** Every history resource of the patient. */
export function historyResources(ctx: FhirContext, patientId: string, h: PatientHistorySource) {
  return [
    ...h.procedures.map((p) => toPastProcedure(ctx, patientId, p)),
    ...h.conditions.map((c) => toPastCondition(ctx, patientId, c)),
    ...h.family.map((f) => toFamilyMemberHistory(ctx, patientId, f)),
    ...h.social.flatMap((s) => toSocialHistoryObservations(ctx, patientId, s, h.sensitiveIncluded)),
  ];
}
