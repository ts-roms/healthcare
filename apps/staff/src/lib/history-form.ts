import { z } from "zod";
import type {
  FamilyHistoryState,
  FamilyRelationship,
  FamilyReview,
  FamilyUnknownReason,
  HistoryDatePrecision,
  HistoryInformant,
  ReportedMedicationStatus,
  SocialHistoryFields,
  SocialHistoryVersion,
  UseStatus,
} from "./api/types";

/**
 * Patient history helpers for the staff app (docs/domains/patient-history.md). The API (`libs/clinic` history)
 * validates, audits and decides; these give field-level errors, payloads and display text. Nothing here scores or
 * infers anything: the history is what was reported or documented. Entries are never edited: a mistake is marked
 * "entered in error" (with a reason) and recorded again; the social history is recorded as a new version.
 */

export const INFORMANT_LABEL: Record<HistoryInformant, string> = { patient: "Patient", relative: "Relative", other_provider: "Another provider" };

export const RELATIONSHIP_LABEL: Record<FamilyRelationship, string> = {
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
  other: "Other relative",
};

export const CONDITION_STATUS_LABEL: Record<"active" | "resolved" | "unknown", string> = {
  active: "Still present (as reported)",
  resolved: "Resolved (as reported)",
  unknown: "Not known",
};

export const MEDICATION_STATUS_LABEL: Record<ReportedMedicationStatus, string> = {
  taking: "Taking (as reported)",
  stopped: "Stopped",
  unknown: "Not known whether still taking",
};

export const USE_STATUS_LABEL: Record<UseStatus, string> = { never: "Never", former: "Former", current: "Current", unknown: "Not known" };

export const UNKNOWN_REASON_LABEL: Record<FamilyUnknownReason, string> = {
  adopted: "Adopted",
  not_known: "Not known to the patient",
  declined_to_answer: "Declined to answer",
};

/** Where an entry comes from, as a short label. */
export function sourceLabel(e: { source: string; reportedBy?: HistoryInformant | null }): string {
  if (e.source === "external_import") return "Imported";
  if (e.source === "recorded_here") return "Documented here";
  return e.reportedBy ? `Reported by ${INFORMANT_LABEL[e.reportedBy].toLowerCase()}` : "Reported";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A past date at its precision: "2019", "May 2019", the day as `formatDate` prints it, or "Date not known". */
export function partialDateLabel(value: string | null, precision: HistoryDatePrecision | null, formatDate: (isoDate: string) => string): string {
  if (!value || !precision) return "Date not known";
  if (precision === "year") return value.slice(0, 4);
  if (precision === "month") return `${MONTHS[Number(value.slice(5, 7)) - 1] ?? ""} ${value.slice(0, 4)}`.trim();
  return formatDate(value);
}

/**
 * The family history state as words and a badge variant (the page adds an icon: never colour alone). "No known family
 * history" only after a recorded review, as for allergies; never-asked says so.
 */
export function familyStateView(
  state: FamilyHistoryState,
  latestReview: Pick<FamilyReview, "unknownReason"> | null,
): { label: string; variant: "success" | "warning" | "info" | "neutral"; tone: "recorded" | "none" | "unknown" | "missing" } {
  switch (state) {
    case "recorded":
      return { label: "Family history recorded", variant: "info", tone: "recorded" };
    case "none_known":
      return { label: "No known family history", variant: "success", tone: "none" };
    case "unknown":
      return {
        label: `Family history not known${latestReview?.unknownReason ? ` (${UNKNOWN_REASON_LABEL[latestReview.unknownReason].toLowerCase()})` : ""}`,
        variant: "neutral",
        tone: "unknown",
      };
    default:
      return { label: "Family history not recorded — ask the patient", variant: "warning", tone: "missing" };
  }
}

/** "Current — Cigarettes, 10 a day" / "Former — quit 2015" / "Never"; null when not asked. */
export function tobaccoText(f: Pick<SocialHistoryFields, "tobaccoStatus" | "tobaccoType" | "tobaccoAmount" | "tobaccoQuitYear">): string | null {
  if (!f.tobaccoStatus) return null;
  const details = [f.tobaccoType, f.tobaccoAmount, f.tobaccoQuitYear ? `quit ${f.tobaccoQuitYear}` : null].filter(Boolean);
  return details.length ? `${USE_STATUS_LABEL[f.tobaccoStatus]} — ${details.join(", ")}` : USE_STATUS_LABEL[f.tobaccoStatus];
}

export function alcoholText(f: Pick<SocialHistoryFields, "alcoholStatus" | "alcoholFrequency">): string | null {
  if (!f.alcoholStatus) return null;
  return f.alcoholFrequency ? `${USE_STATUS_LABEL[f.alcoholStatus]} — ${f.alcoholFrequency}` : USE_STATUS_LABEL[f.alcoholStatus];
}

// ---- forms ------------------------------------------------------------------------------------------------------

const PARTIAL_DATE = /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/;
const partialDate = z
  .string()
  .trim()
  .refine((v) => v === "" || PARTIAL_DATE.test(v), "Give the year (2019), month (2019-05) or day (2019-05-12), or leave it empty");
const codeSystemKey = z
  .string()
  .trim()
  .toLowerCase()
  .refine((v) => v === "" || /^[a-z0-9][a-z0-9._-]{0,39}$/.test(v), "Use lower-case letters, digits, dots, hyphens or underscores");
const optional = (max: number) => z.string().trim().max(max);
const uuid = z.union([z.literal(""), z.uuid()]).optional();

const provenance = {
  source: z.enum(["reported", "recorded_here"]),
  reportedBy: z.union([z.literal(""), z.enum(["patient", "relative", "other_provider"])]),
  sourceDescription: optional(300),
  encounterId: uuid,
};
const provenanceCheck = (v: { source: string; reportedBy: string }, ctx: z.RefinementCtx) => {
  if (v.source === "reported" && !v.reportedBy) ctx.addIssue({ code: "custom", message: "Say who reported it", path: ["reportedBy"] });
};
const codeCheck = (v: { codeSystem: string; code: string }, ctx: z.RefinementCtx) => {
  if (Boolean(v.code) !== Boolean(v.codeSystem)) ctx.addIssue({ code: "custom", message: "Give the code with its code system (or neither)", path: ["code"] });
};

export const procedureFormSchema = z
  .object({
    description: z.string().trim().min(1, "Name the procedure").max(300),
    codeSystem: codeSystemKey,
    code: optional(60),
    performed: partialDate,
    performer: optional(300),
    bodySite: optional(120),
    notes: optional(2000),
    ...provenance,
  })
  .superRefine(provenanceCheck)
  .superRefine(codeCheck);
export type ProcedureForm = z.input<typeof procedureFormSchema>;
export const BLANK_PROCEDURE: ProcedureForm = {
  description: "",
  codeSystem: "",
  code: "",
  performed: "",
  performer: "",
  bodySite: "",
  notes: "",
  source: "reported",
  reportedBy: "patient",
  sourceDescription: "",
};

export const conditionFormSchema = z
  .object({
    description: z.string().trim().min(1, "Name the condition").max(300),
    codeSystem: codeSystemKey,
    code: optional(60),
    onset: partialDate,
    status: z.enum(["active", "resolved", "unknown"]),
    diagnosedBy: optional(300),
    notes: optional(2000),
    ...provenance,
  })
  .superRefine(provenanceCheck)
  .superRefine(codeCheck);
export type ConditionForm = z.input<typeof conditionFormSchema>;
export const BLANK_CONDITION: ConditionForm = {
  description: "",
  codeSystem: "",
  code: "",
  onset: "",
  status: "active",
  diagnosedBy: "",
  notes: "",
  source: "reported",
  reportedBy: "patient",
  sourceDescription: "",
};

export const medicationFormSchema = z
  .object({
    medication: z.string().trim().min(1, "Name the medicine").max(200),
    codeSystem: codeSystemKey,
    code: optional(60),
    dose: optional(200),
    reason: optional(300),
    prescribedBy: optional(300),
    started: partialDate,
    status: z.enum(["taking", "stopped", "unknown"]),
    stopped: partialDate,
    notes: optional(2000),
    ...provenance,
  })
  .superRefine(provenanceCheck)
  .superRefine(codeCheck)
  .superRefine((v, ctx) => {
    if (v.stopped && v.status !== "stopped") ctx.addIssue({ code: "custom", message: "A stop date is for a medicine that was stopped", path: ["stopped"] });
  });
export type MedicationForm = z.input<typeof medicationFormSchema>;
export const BLANK_MEDICATION: MedicationForm = {
  medication: "",
  codeSystem: "",
  code: "",
  dose: "",
  reason: "",
  prescribedBy: "",
  started: "",
  status: "taking",
  stopped: "",
  notes: "",
  source: "reported",
  reportedBy: "patient",
  sourceDescription: "",
};

export const stopMedicationFormSchema = z.object({ stopped: partialDate, note: optional(500) });
export type StopMedicationForm = z.input<typeof stopMedicationFormSchema>;

/** "Since May 2019" / "Stopped 2025" / "May 2019 – 2025"; null when no date is known. */
export function medicationPeriodLabel(
  m: {
    started: string | null;
    startedPrecision: HistoryDatePrecision | null;
    stopped: string | null;
    stoppedPrecision: HistoryDatePrecision | null;
    status: ReportedMedicationStatus;
  },
  formatDate: (isoDate: string) => string,
): string | null {
  const start = m.started ? partialDateLabel(m.started, m.startedPrecision, formatDate) : null;
  const stop = m.stopped ? partialDateLabel(m.stopped, m.stoppedPrecision, formatDate) : null;
  if (start && stop) return `${start} – ${stop}`;
  if (stop) return `stopped ${stop}`;
  if (start) return m.status === "stopped" ? `from ${start}` : `since ${start}`;
  return null;
}

export const familyFormSchema = z
  .object({
    relationship: z.union([z.literal(""), z.enum(Object.keys(RELATIONSHIP_LABEL) as [FamilyRelationship, ...FamilyRelationship[]])]),
    relationshipText: optional(100),
    condition: z.string().trim().min(1, "Name the condition").max(300),
    codeSystem: codeSystemKey,
    code: optional(60),
    onsetAge: z
      .string()
      .trim()
      .refine((v) => v === "" || (/^\d{1,3}$/.test(v) && Number(v) <= 130), "An age from 0 to 130, or leave it empty"),
    deceased: z.enum(["", "yes", "no"]),
    causeOfDeath: optional(300),
    notes: optional(2000),
    reportedBy: z.enum(["patient", "relative", "other_provider"]),
    encounterId: uuid,
  })
  .superRefine(codeCheck)
  .superRefine((v, ctx) => {
    if (!v.relationship) ctx.addIssue({ code: "custom", message: "Choose the relative", path: ["relationship"] });
    if (v.relationship === "other" && !v.relationshipText) ctx.addIssue({ code: "custom", message: "Name the relative", path: ["relationshipText"] });
    if (v.causeOfDeath && v.deceased !== "yes")
      ctx.addIssue({ code: "custom", message: "A cause of death is for a relative who has died", path: ["causeOfDeath"] });
  });
export type FamilyForm = z.input<typeof familyFormSchema>;
export const BLANK_FAMILY: FamilyForm = {
  relationship: "",
  relationshipText: "",
  condition: "",
  codeSystem: "",
  code: "",
  onsetAge: "",
  deceased: "",
  causeOfDeath: "",
  notes: "",
  reportedBy: "patient",
};

export const reviewFormSchema = z
  .object({
    outcome: z.enum(["reviewed", "none_known", "unknown"]),
    unknownReason: z.union([z.literal(""), z.enum(["adopted", "not_known", "declined_to_answer"])]),
    notes: optional(500),
    encounterId: uuid,
  })
  .superRefine((v, ctx) => {
    if (v.outcome === "unknown" && !v.unknownReason) ctx.addIssue({ code: "custom", message: "Say why it is not known", path: ["unknownReason"] });
  });
export type ReviewForm = z.input<typeof reviewFormSchema>;

/** Drops empty strings (the API takes absent fields, never blanks). */
function present<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== "" && v !== undefined)) as Partial<T>;
}

export function procedurePayload(f: z.output<typeof procedureFormSchema>) {
  const { reportedBy, source, ...rest } = f;
  return { ...present(rest), source, ...(source === "reported" ? { reportedBy } : {}) };
}

export function conditionPayload(f: z.output<typeof conditionFormSchema>) {
  const { reportedBy, source, ...rest } = f;
  return { ...present(rest), source, ...(source === "reported" ? { reportedBy } : {}) };
}

export function medicationPayload(f: z.output<typeof medicationFormSchema>) {
  const { reportedBy, source, stopped, ...rest } = f;
  return { ...present(rest), ...(f.status === "stopped" && stopped ? { stopped } : {}), source, ...(source === "reported" ? { reportedBy } : {}) };
}

export function familyPayload(f: z.output<typeof familyFormSchema>) {
  const { onsetAge, deceased, causeOfDeath, ...rest } = f;
  return {
    ...present(rest),
    ...(onsetAge ? { onsetAge: Number(onsetAge) } : {}),
    ...(deceased ? { deceased: deceased === "yes" } : {}),
    ...(deceased === "yes" && causeOfDeath ? { causeOfDeath } : {}),
  };
}

export function reviewPayload(f: z.output<typeof reviewFormSchema>) {
  return {
    outcome: f.outcome,
    ...(f.outcome === "unknown" ? { unknownReason: f.unknownReason } : {}),
    ...present({ notes: f.notes, encounterId: f.encounterId }),
  };
}

// ---- social history versions ------------------------------------------------------------------------------------

const TEXT_FIELDS = [
  "tobaccoType",
  "tobaccoAmount",
  "alcoholFrequency",
  "substanceUse",
  "occupation",
  "occupationalExposures",
  "livingSituation",
  "physicalActivity",
  "diet",
  "sexualHistory",
  "notes",
] as const;
const SENSITIVE = new Set<string>(["substanceUse", "sexualHistory"]);

export interface SocialForm {
  tobaccoStatus: UseStatus | "";
  tobaccoType: string;
  tobaccoAmount: string;
  tobaccoQuitYear: string;
  alcoholStatus: UseStatus | "";
  alcoholFrequency: string;
  substanceUse: string;
  occupation: string;
  occupationalExposures: string;
  livingSituation: string;
  physicalActivity: string;
  diet: string;
  sexualHistory: string;
  notes: string;
  /** YYYY-MM-DD; empty for today. */
  effectiveDate: string;
}

/** The form prefilled from the current version (a new version starts from it). */
export function socialFormFrom(current: SocialHistoryFields | null): SocialForm {
  const text = (k: (typeof TEXT_FIELDS)[number]) => current?.[k] ?? "";
  return {
    tobaccoStatus: current?.tobaccoStatus ?? "",
    tobaccoType: text("tobaccoType"),
    tobaccoAmount: text("tobaccoAmount"),
    tobaccoQuitYear: current?.tobaccoQuitYear ? String(current.tobaccoQuitYear) : "",
    alcoholStatus: current?.alcoholStatus ?? "",
    alcoholFrequency: text("alcoholFrequency"),
    substanceUse: text("substanceUse"),
    occupation: text("occupation"),
    occupationalExposures: text("occupationalExposures"),
    livingSituation: text("livingSituation"),
    physicalActivity: text("physicalActivity"),
    diet: text("diet"),
    sexualHistory: text("sexualHistory"),
    notes: text("notes"),
    effectiveDate: "",
  };
}

/**
 * The new version's request: only what differs from the current version (a changed field, or null to clear it), on
 * top of that version (`basedOn`). Sensitive parts are sent only by a user who may see them; for anyone else they are
 * carried over by the API unchanged. Returns an error message when the form is not valid.
 */
export function socialPayload(
  form: SocialForm,
  current: Pick<SocialHistoryVersion, "id" | keyof SocialHistoryFields> | null,
  sensitiveAccess: boolean,
): { ok: true; body: Record<string, unknown> } | { ok: false; message: string } {
  const body: Record<string, unknown> = { basedOn: current?.id ?? null };
  if (form.effectiveDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.effectiveDate)) return { ok: false, message: "Give the date as YYYY-MM-DD" };
    body["effectiveDate"] = form.effectiveDate;
  }
  const status = (key: "tobaccoStatus" | "alcoholStatus") => {
    const value = form[key] === "" ? null : form[key];
    if (value !== (current?.[key] ?? null)) body[key] = value;
  };
  status("tobaccoStatus");
  status("alcoholStatus");
  const quit = form.tobaccoQuitYear.trim();
  if (quit && !/^\d{4}$/.test(quit)) return { ok: false, message: "Give the year stopped as YYYY" };
  const quitYear = quit ? Number(quit) : null;
  if (quitYear !== (current?.tobaccoQuitYear ?? null)) body["tobaccoQuitYear"] = quitYear;
  for (const key of TEXT_FIELDS) {
    if (SENSITIVE.has(key) && !sensitiveAccess) continue;
    const value = form[key].trim() === "" ? null : form[key].trim();
    if (value !== (current?.[key] ?? null)) body[key] = value;
  }
  if (Object.keys(body).length === 1 && !body["effectiveDate"]) return { ok: false, message: "Nothing changed from the current version" };
  return { ok: true, body };
}
