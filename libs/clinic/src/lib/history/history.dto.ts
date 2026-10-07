import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { isPartialDateText } from "./history.rules";
import {
  FAMILY_RELATIONSHIPS,
  FAMILY_REVIEW_OUTCOMES,
  FAMILY_UNKNOWN_REASONS,
  HISTORY_INFORMANTS,
  PAST_CONDITION_STATUSES,
  REPORTED_MEDICATION_STATUSES,
  USE_STATUSES,
} from "./history.schema";

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => text(max).optional();
const partialDate = z.string().trim().refine(isPartialDateText, "Give the year (YYYY), month (YYYY-MM) or day (YYYY-MM-DD)");
/** A key naming a code system the organization uses (e.g. "icd-10", "procedure"); no national code set is assumed. */
const codeSystemKey = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9._-]{0,39}$/, "Use lower-case letters, digits, dots, hyphens or underscores");

const coded = {
  codeSystem: codeSystemKey.optional(),
  code: optionalText(60),
};
const codeTogether = (v: { codeSystem?: string; code?: string }) => Boolean(v.codeSystem) === Boolean(v.code);
const codeMessage = { message: "Give the code with its code system", path: ["code"] };

/** Who told the organization, or a clinician's own documentation here (e.g. from records the patient brought). */
const provenance = {
  source: z.enum(["reported", "recorded_here"]).default("reported"),
  reportedBy: z.enum(HISTORY_INFORMANTS).optional(),
  /** Where the information comes from (e.g. "Discharge summary, 2019"). */
  sourceDescription: optionalText(300),
  /** The consultation in which the history was taken. */
  encounterId: z.uuid().optional(),
};
const informantCheck = (v: { source: "reported" | "recorded_here"; reportedBy?: string }) => (v.source === "reported") === Boolean(v.reportedBy);
const informantMessage = { message: "Say who reported it (patient, relative or another provider), or record it as documented here", path: ["reportedBy"] };

export const recordPastProcedureSchema = z
  .object({
    /** The procedure as written (e.g. "Appendectomy"). */
    description: text(300),
    ...coded,
    /** When it was done, as precise as known; leave out when not known. */
    performed: partialDate.optional(),
    /** Where and by whom, as reported. */
    performer: optionalText(300),
    /** Laterality or body site as written (e.g. "left knee"). */
    bodySite: optionalText(120),
    notes: optionalText(2000),
    ...provenance,
  })
  .refine(codeTogether, codeMessage)
  .refine(informantCheck, informantMessage);
export class RecordPastProcedureDto extends createZodDto(recordPastProcedureSchema) {}

export const recordPastConditionSchema = z
  .object({
    /** The condition as written (e.g. "Pulmonary tuberculosis, treated"). */
    description: text(300),
    ...coded,
    onset: partialDate.optional(),
    /** As reported: still present, resolved or not known. */
    status: z.enum(PAST_CONDITION_STATUSES),
    /** Where it was diagnosed or treated, as reported. */
    diagnosedBy: optionalText(300),
    notes: optionalText(2000),
    ...provenance,
  })
  .refine(codeTogether, codeMessage)
  .refine(informantCheck, informantMessage);
export class RecordPastConditionDto extends createZodDto(recordPastConditionSchema) {}

export const recordReportedMedicationSchema = z
  .object({
    /** The medicine as written (e.g. "Losartan 50 mg tablet", "Lagundi syrup"). */
    medication: text(200),
    ...coded,
    /** How the patient takes it, as said (e.g. "1 tablet every morning"). */
    dose: optionalText(200),
    /** What it is for, as reported. */
    reason: optionalText(300),
    /** Who prescribed it or where it came from (e.g. "Cardiologist at another hospital", "Over the counter"). */
    prescribedBy: optionalText(300),
    started: partialDate.optional(),
    /** As reported: still taking, already stopped, or not known. */
    status: z.enum(REPORTED_MEDICATION_STATUSES),
    /** When it was stopped, as precise as known (only for a medicine already stopped). */
    stopped: partialDate.optional(),
    notes: optionalText(2000),
    ...provenance,
  })
  .refine(codeTogether, codeMessage)
  .refine(informantCheck, informantMessage)
  .refine((v) => !v.stopped || v.status === "stopped", { message: "A stop date is given for a medicine that was stopped", path: ["stopped"] });
export class RecordReportedMedicationDto extends createZodDto(recordReportedMedicationSchema) {}

/** The patient no longer takes a medicine recorded as taken (or not known): when, as precise as known, and an optional note. */
export const stopReportedMedicationSchema = z.object({
  stopped: partialDate.optional(),
  note: optionalText(500),
});
export class StopReportedMedicationDto extends createZodDto(stopReportedMedicationSchema) {}

export const recordFamilyHistorySchema = z
  .object({
    relationship: z.enum(FAMILY_RELATIONSHIPS),
    /** Detail ("older sister") or, for "other", the relative. */
    relationshipText: optionalText(100),
    condition: text(300),
    ...coded,
    /** Age of the relative when the condition began, as reported. */
    onsetAge: z.number().int().min(0).max(130).optional(),
    /** Left out: not stated. */
    deceased: z.boolean().optional(),
    causeOfDeath: optionalText(300),
    notes: optionalText(2000),
    reportedBy: z.enum(HISTORY_INFORMANTS).default("patient"),
    encounterId: z.uuid().optional(),
  })
  .refine(codeTogether, codeMessage)
  .refine((v) => v.relationship !== "other" || Boolean(v.relationshipText), { message: "Name the relative", path: ["relationshipText"] })
  .refine((v) => !v.causeOfDeath || v.deceased === true, { message: "A cause of death is recorded for a relative who has died", path: ["causeOfDeath"] });
export class RecordFamilyHistoryDto extends createZodDto(recordFamilyHistorySchema) {}

export const familyReviewSchema = z
  .object({
    /** reviewed: complete as listed; none_known: no family history known; unknown: not known (with the reason). */
    outcome: z.enum(FAMILY_REVIEW_OUTCOMES),
    unknownReason: z.enum(FAMILY_UNKNOWN_REASONS).optional(),
    notes: optionalText(500),
    encounterId: z.uuid().optional(),
  })
  .refine((v) => (v.outcome === "unknown") === Boolean(v.unknownReason), { message: "Say why the family history is not known", path: ["unknownReason"] });
export class FamilyReviewDto extends createZodDto(familyReviewSchema) {}

const socialText = (max: number) => text(max).nullable().optional();

/**
 * A new version of the social history. It starts from the current version: a field given replaces it, null clears it,
 * a field left out is carried over. `basedOn` is the current version's id (null when there is none yet): recording on
 * top of a version that is no longer current is refused, so nobody overwrites a change they have not seen.
 */
export const recordSocialHistorySchema = z.object({
  basedOn: z.uuid().nullable(),
  /** The day the information was given (YYYY-MM-DD); today in the facility's time zone when left out. */
  effectiveDate: z.iso.date().optional(),
  tobaccoStatus: z.enum(USE_STATUSES).nullable().optional(),
  /** e.g. "Cigarettes", "Chewing tobacco", "Vape". */
  tobaccoType: socialText(120),
  /** As said (e.g. "10 sticks a day"). */
  tobaccoAmount: socialText(120),
  tobaccoQuitYear: z.number().int().min(1900).max(2200).nullable().optional(),
  alcoholStatus: z.enum(USE_STATUSES).nullable().optional(),
  alcoholFrequency: socialText(200),
  /** Sensitive. */
  substanceUse: socialText(1000),
  occupation: socialText(200),
  occupationalExposures: socialText(1000),
  livingSituation: socialText(1000),
  physicalActivity: socialText(1000),
  diet: socialText(1000),
  /** Sensitive. */
  sexualHistory: socialText(1000),
  notes: socialText(2000),
  encounterId: z.uuid().optional(),
});
export class RecordSocialHistoryDto extends createZodDto(recordSocialHistorySchema) {}

export const historyInErrorSchema = z.object({ reason: z.string().trim().min(3, "Give a reason").max(500) });
export class HistoryInErrorDto extends createZodDto(historyInErrorSchema) {}

// ---- MyHealth: the patient's own answers -----------------------------------------------------------------------------

/**
 * What a patient (or a guardian acting for a dependent) reports in MyHealth: a history questionnaire answered in one
 * go. Every entry is recorded as reported by the patient (or a relative), without a code, a clinician's notes or a
 * consultation. Substance use and sexual history are not asked here. Nothing is a diagnosis or a prescription.
 */
const portalMedicationSchema = z
  .object({
    medication: text(200),
    dose: optionalText(200),
    reason: optionalText(300),
    prescribedBy: optionalText(300),
    started: partialDate.optional(),
    status: z.enum(REPORTED_MEDICATION_STATUSES),
    stopped: partialDate.optional(),
  })
  .refine((v) => !v.stopped || v.status === "stopped", { message: "A stop date is given for a medicine that was stopped", path: ["stopped"] });

const portalConditionSchema = z.object({
  description: text(300),
  onset: partialDate.optional(),
  status: z.enum(PAST_CONDITION_STATUSES),
  diagnosedBy: optionalText(300),
});

const portalProcedureSchema = z.object({
  description: text(300),
  performed: partialDate.optional(),
  performer: optionalText(300),
  bodySite: optionalText(120),
});

const portalFamilySchema = z
  .object({
    relationship: z.enum(FAMILY_RELATIONSHIPS),
    relationshipText: optionalText(100),
    condition: text(300),
    onsetAge: z.number().int().min(0).max(130).optional(),
    deceased: z.boolean().optional(),
    causeOfDeath: optionalText(300),
  })
  .refine((v) => v.relationship !== "other" || Boolean(v.relationshipText), { message: "Name the relative", path: ["relationshipText"] })
  .refine((v) => !v.causeOfDeath || v.deceased === true, { message: "A cause of death is recorded for a relative who has died", path: ["causeOfDeath"] });

/** The non-sensitive parts of the social history; a field left out is carried over from the current version, null clears it. */
const portalSocialSchema = z.object({
  tobaccoStatus: z.enum(USE_STATUSES).nullable().optional(),
  tobaccoType: socialText(120),
  tobaccoAmount: socialText(120),
  tobaccoQuitYear: z.number().int().min(1900).max(2200).nullable().optional(),
  alcoholStatus: z.enum(USE_STATUSES).nullable().optional(),
  alcoholFrequency: socialText(200),
  occupation: socialText(200),
  occupationalExposures: socialText(1000),
  livingSituation: socialText(1000),
  physicalActivity: socialText(1000),
  diet: socialText(1000),
});

export const MAX_PORTAL_ENTRIES = 30;

export const portalHistorySubmissionSchema = z
  .object({
    medications: z.array(portalMedicationSchema).max(MAX_PORTAL_ENTRIES).default([]),
    conditions: z.array(portalConditionSchema).max(MAX_PORTAL_ENTRIES).default([]),
    procedures: z.array(portalProcedureSchema).max(MAX_PORTAL_ENTRIES).default([]),
    family: z.array(portalFamilySchema).max(MAX_PORTAL_ENTRIES).default([]),
    social: portalSocialSchema.optional(),
  })
  .refine((v) => v.medications.length + v.conditions.length + v.procedures.length + v.family.length > 0 || v.social !== undefined, {
    message: "Answer at least one part of the questionnaire",
    path: ["medications"],
  });
export class PortalHistorySubmissionDto extends createZodDto(portalHistorySubmissionSchema) {}
export type PortalHistorySubmissionInput = z.output<typeof portalHistorySubmissionSchema>;
