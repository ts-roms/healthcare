import type { FamilyRelationship, HistoryUseStatus, PortalHealthHistory, PortalHistorySubmission } from "./api/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A past date as precisely as it is known: "2019", "May 2019", "May 12, 2019" (en-PH), or "Date not known". */
export function pastDate(value: string | null): string {
  if (!value) return "Date not known";
  if (/^\d{4}$/.test(value)) return value;
  if (/^\d{4}-\d{2}$/.test(value)) return `${MONTHS[Number(value.slice(5, 7)) - 1] ?? ""} ${value.slice(0, 4)}`.trim();
  return new Intl.DateTimeFormat("en-PH", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

/** Where an entry comes from, in plain words. */
export function historySourceText(source: string, recordedVia: "staff" | "patient_portal" = "staff"): string {
  if (recordedVia === "patient_portal") return "Reported here in MyHealth";
  if (source === "recorded_here") return "Recorded by our clinic from your records";
  if (source === "external_import") return "From another provider's records";
  return "As told to our clinic";
}

// ---- the questionnaire ---------------------------------------------------------------------------------------------

/** A past date as the patient types it: a year, a month (YYYY-MM) or a day (YYYY-MM-DD), from 1900; blank means not known. */
export const PARTIAL_DATE = /^(19|20)\d{2}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/;

export function partialDateProblem(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  return PARTIAL_DATE.test(v) ? null : "Give the year (2019), the month (2019-05) or the day (2019-05-12)";
}

export const RELATIONSHIP_OPTIONS: Array<{ value: FamilyRelationship; label: string }> = [
  { value: "mother", label: "Mother" },
  { value: "father", label: "Father" },
  { value: "sister", label: "Sister" },
  { value: "brother", label: "Brother" },
  { value: "sibling", label: "Sibling" },
  { value: "half_sibling", label: "Half-sibling" },
  { value: "daughter", label: "Daughter" },
  { value: "son", label: "Son" },
  { value: "child", label: "Child" },
  { value: "maternal_grandmother", label: "Grandmother (mother's side)" },
  { value: "maternal_grandfather", label: "Grandfather (mother's side)" },
  { value: "paternal_grandmother", label: "Grandmother (father's side)" },
  { value: "paternal_grandfather", label: "Grandfather (father's side)" },
  { value: "maternal_aunt", label: "Aunt (mother's side)" },
  { value: "maternal_uncle", label: "Uncle (mother's side)" },
  { value: "paternal_aunt", label: "Aunt (father's side)" },
  { value: "paternal_uncle", label: "Uncle (father's side)" },
  { value: "cousin", label: "Cousin" },
  { value: "other", label: "Another relative" },
];

export const USE_OPTIONS: Array<{ value: HistoryUseStatus; label: string }> = [
  { value: "never", label: "Never" },
  { value: "former", label: "In the past, not now" },
  { value: "current", label: "Yes, currently" },
  { value: "unknown", label: "I'd rather not say" },
];

export const MEDICATION_STATUS_OPTIONS: Array<{ value: "taking" | "stopped" | "unknown"; label: string }> = [
  { value: "taking", label: "I take it now" },
  { value: "stopped", label: "I stopped taking it" },
  { value: "unknown", label: "Not sure" },
];

export const CONDITION_STATUS_OPTIONS: Array<{ value: "active" | "resolved" | "unknown"; label: string }> = [
  { value: "active", label: "I still have it" },
  { value: "resolved", label: "It is gone" },
  { value: "unknown", label: "Not sure" },
];

/** A medicine row as typed. */
export interface MedicineDraft {
  medication: string;
  dose: string;
  reason: string;
  prescribedBy: string;
  started: string;
  status: "taking" | "stopped" | "unknown";
  stopped: string;
}
export interface ConditionDraft {
  description: string;
  onset: string;
  status: "active" | "resolved" | "unknown";
  diagnosedBy: string;
}
export interface ProcedureDraft {
  description: string;
  performed: string;
  performer: string;
  bodySite: string;
}
export interface FamilyDraft {
  relationship: FamilyRelationship;
  relationshipText: string;
  condition: string;
  onsetAge: string;
  deceased: "" | "yes" | "no";
  causeOfDeath: string;
}
export interface SocialDraft {
  tobaccoStatus: "" | HistoryUseStatus;
  tobaccoType: string;
  tobaccoAmount: string;
  tobaccoQuitYear: string;
  alcoholStatus: "" | HistoryUseStatus;
  alcoholFrequency: string;
  occupation: string;
  occupationalExposures: string;
  livingSituation: string;
  physicalActivity: string;
  diet: string;
}

export const EMPTY_MEDICINE: MedicineDraft = { medication: "", dose: "", reason: "", prescribedBy: "", started: "", status: "taking", stopped: "" };
export const EMPTY_CONDITION: ConditionDraft = { description: "", onset: "", status: "active", diagnosedBy: "" };
export const EMPTY_PROCEDURE: ProcedureDraft = { description: "", performed: "", performer: "", bodySite: "" };
export const EMPTY_FAMILY: FamilyDraft = { relationship: "mother", relationshipText: "", condition: "", onsetAge: "", deceased: "", causeOfDeath: "" };
export const EMPTY_SOCIAL: SocialDraft = {
  tobaccoStatus: "",
  tobaccoType: "",
  tobaccoAmount: "",
  tobaccoQuitYear: "",
  alcoholStatus: "",
  alcoholFrequency: "",
  occupation: "",
  occupationalExposures: "",
  livingSituation: "",
  physicalActivity: "",
  diet: "",
};

const opt = (v: string) => (v.trim() ? v.trim() : undefined);

/**
 * The questionnaire as typed, checked and turned into what the API takes: blank rows are dropped, blank optional
 * fields left out; a problem names the first thing to fix. The "Daily life" part is sent only when the patient filled
 * something in (a field left blank there is left as the clinic has it).
 */
export function buildSubmission(draft: {
  medications: MedicineDraft[];
  conditions: ConditionDraft[];
  procedures: ProcedureDraft[];
  family: FamilyDraft[];
  social: SocialDraft;
  socialTouched: boolean;
}): { ok: true; body: PortalHistorySubmission } | { ok: false; problem: string } {
  const medications = draft.medications.filter((m) => m.medication.trim());
  const conditions = draft.conditions.filter((c) => c.description.trim());
  const procedures = draft.procedures.filter((p) => p.description.trim());
  const family = draft.family.filter((f) => f.condition.trim());
  for (const m of medications) {
    const problem = partialDateProblem(m.started) ?? partialDateProblem(m.stopped);
    if (problem) return { ok: false, problem: `${m.medication.trim()}: ${problem}` };
    if (m.stopped.trim() && m.status !== "stopped") return { ok: false, problem: `${m.medication.trim()}: a stop date only goes with "I stopped taking it"` };
  }
  for (const c of conditions) {
    const problem = partialDateProblem(c.onset);
    if (problem) return { ok: false, problem: `${c.description.trim()}: ${problem}` };
  }
  for (const p of procedures) {
    const problem = partialDateProblem(p.performed);
    if (problem) return { ok: false, problem: `${p.description.trim()}: ${problem}` };
  }
  for (const f of family) {
    if (f.relationship === "other" && !f.relationshipText.trim()) return { ok: false, problem: `${f.condition.trim()}: say who the relative is` };
    if (f.onsetAge.trim() && !/^\d{1,3}$/.test(f.onsetAge.trim())) return { ok: false, problem: `${f.condition.trim()}: the age is a number` };
    if (f.causeOfDeath.trim() && f.deceased !== "yes")
      return { ok: false, problem: `${f.condition.trim()}: a cause of death goes with a relative who has passed away` };
  }
  const s = draft.social;
  const social: PortalHistorySubmission["social"] | undefined = draft.socialTouched
    ? {
        ...(s.tobaccoStatus ? { tobaccoStatus: s.tobaccoStatus } : {}),
        ...(s.tobaccoType.trim() ? { tobaccoType: s.tobaccoType.trim() } : {}),
        ...(s.tobaccoAmount.trim() ? { tobaccoAmount: s.tobaccoAmount.trim() } : {}),
        ...(s.tobaccoQuitYear.trim() ? { tobaccoQuitYear: Number(s.tobaccoQuitYear.trim()) } : {}),
        ...(s.alcoholStatus ? { alcoholStatus: s.alcoholStatus } : {}),
        ...(s.alcoholFrequency.trim() ? { alcoholFrequency: s.alcoholFrequency.trim() } : {}),
        ...(s.occupation.trim() ? { occupation: s.occupation.trim() } : {}),
        ...(s.occupationalExposures.trim() ? { occupationalExposures: s.occupationalExposures.trim() } : {}),
        ...(s.livingSituation.trim() ? { livingSituation: s.livingSituation.trim() } : {}),
        ...(s.physicalActivity.trim() ? { physicalActivity: s.physicalActivity.trim() } : {}),
        ...(s.diet.trim() ? { diet: s.diet.trim() } : {}),
      }
    : undefined;
  if (social && s.tobaccoQuitYear.trim() && !/^(19|20)\d{2}$/.test(s.tobaccoQuitYear.trim()))
    return { ok: false, problem: "The year you stopped smoking is a year" };
  const socialGiven = social !== undefined && Object.keys(social).length > 0;
  if (medications.length + conditions.length + procedures.length + family.length === 0 && !socialGiven) {
    return { ok: false, problem: "Fill in at least one part before sending." };
  }
  return {
    ok: true,
    body: {
      medications: medications.map((m) => ({
        medication: m.medication.trim(),
        dose: opt(m.dose),
        reason: opt(m.reason),
        prescribedBy: opt(m.prescribedBy),
        started: opt(m.started),
        status: m.status,
        stopped: m.status === "stopped" ? opt(m.stopped) : undefined,
      })),
      conditions: conditions.map((c) => ({ description: c.description.trim(), onset: opt(c.onset), status: c.status, diagnosedBy: opt(c.diagnosedBy) })),
      procedures: procedures.map((p) => ({
        description: p.description.trim(),
        performed: opt(p.performed),
        performer: opt(p.performer),
        bodySite: opt(p.bodySite),
      })),
      family: family.map((f) => ({
        relationship: f.relationship,
        relationshipText: opt(f.relationshipText),
        condition: f.condition.trim(),
        onsetAge: f.onsetAge.trim() ? Number(f.onsetAge.trim()) : undefined,
        deceased: f.deceased === "" ? undefined : f.deceased === "yes",
        causeOfDeath: f.deceased === "yes" ? opt(f.causeOfDeath) : undefined,
      })),
      ...(socialGiven ? { social } : {}),
    },
  };
}

/** "Daily life" as the clinic has it, as a draft to start from (so the patient changes only what differs). */
export function socialDraftFrom(social: PortalHealthHistory["social"]): SocialDraft {
  if (!social) return EMPTY_SOCIAL;
  return {
    tobaccoStatus: social.tobaccoStatus ?? "",
    tobaccoType: social.tobaccoType ?? "",
    tobaccoAmount: social.tobaccoAmount ?? "",
    tobaccoQuitYear: social.tobaccoQuitYear ? String(social.tobaccoQuitYear) : "",
    alcoholStatus: social.alcoholStatus ?? "",
    alcoholFrequency: social.alcoholFrequency ?? "",
    occupation: social.occupation ?? "",
    occupationalExposures: social.occupationalExposures ?? "",
    livingSituation: social.livingSituation ?? "",
    physicalActivity: social.physicalActivity ?? "",
    diet: social.diet ?? "",
  };
}

/** What a refusal from the API means for the patient. */
export function submissionMessage(code: string | undefined, fallback: string): string {
  switch (code) {
    case "date_in_future":
      return "One of the dates is in the future. Check the dates and try again.";
    case "stop_before_start":
      return "A stop date is before the start date. Check the dates and try again.";
    case "history_submission_empty":
      return "Nothing you entered is new.";
    case "rate_limited":
      return "You have sent several questionnaires in the last hour. Please try again later.";
    case "proxy_view_only":
      return "Your access to this person's MyHealth is view-only.";
    default:
      return fallback;
  }
}

export const CONDITION_STATUS_TEXT: Record<PortalHealthHistory["conditions"][number]["status"], string> = {
  active: "Still present",
  resolved: "Resolved",
  unknown: "Status not known",
};

/** "Taking since May 2019" / "Stopped 2020" / "Not known whether still taking". */
export function medicationStatusText(m: Pick<PortalHealthHistory["medications"][number], "status" | "started" | "stopped">): string {
  if (m.status === "stopped") return m.stopped ? `Stopped ${pastDate(m.stopped)}` : "Stopped";
  if (m.status === "taking") return m.started ? `Taking since ${pastDate(m.started)}` : "Taking";
  return "Not known whether still taking";
}

/** The family history state in plain words ("no known illness in the family" only after the clinic asked). */
export function familyStateText(family: Pick<PortalHealthHistory["family"], "state" | "unknownReason">): string {
  switch (family.state) {
    case "recorded":
      return "Conditions in the family, as told to the clinic:";
    case "none_known":
      return "No known illness that runs in the family, as told to the clinic.";
    case "unknown":
      return family.unknownReason === "adopted"
        ? "The family history is not known (adopted)."
        : family.unknownReason === "declined_to_answer"
          ? "The family history was not shared."
          : "The family history is not known.";
    default:
      return "The clinic has not recorded the family history yet.";
  }
}
