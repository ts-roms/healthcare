import { z } from "zod";

/**
 * Pre-consult questionnaire, version 1. Answers are the patient's own words
 * for the clinician to read before the call; they are not a triage decision.
 * Red flags only prompt the patient to seek emergency care and alert the
 * clinician — the platform never decides that a patient is safe to be seen
 * online.
 */
export const RED_FLAGS = {
  chest_pain: "Chest pain or pressure",
  difficulty_breathing: "Difficulty breathing or shortness of breath",
  severe_bleeding: "Heavy bleeding that does not stop",
  fainting: "Fainting, confusion or trouble staying awake",
  stroke_signs: "Sudden weakness, numbness, face drooping or trouble speaking",
  seizure: "A seizure",
  severe_pain: "Sudden severe pain",
  pregnancy_bleeding: "Pregnant with bleeding, severe pain or reduced baby movements",
  self_harm: "Thoughts of harming yourself",
} as const;
export type RedFlag = keyof typeof RED_FLAGS;

const text = (max: number) => z.string().trim().max(max);

export const questionnaireSchema = z.object({
  version: z.literal(1).default(1),
  reasonForVisit: text(1000).min(3, "Tell us why you are consulting"),
  symptoms: text(2000).optional(),
  symptomDurationDays: z.number().int().min(0).max(3650).optional(),
  currentMedications: text(2000).optional(),
  /** Anything new since the clinic last recorded the patient's allergies. */
  newAllergies: text(1000).optional(),
  redFlags: z
    .array(z.enum(Object.keys(RED_FLAGS) as [RedFlag, ...RedFlag[]]))
    .max(9)
    .default([]),
  /** Where the patient is during the call — needed to direct emergency help. */
  locationCity: text(120).min(2, "Where will you be during the call?"),
  /** A number to call if the video connection fails. */
  callbackNumber: text(20).regex(/^[+0-9 ()-]{7,20}$/, "Enter a phone number we can call"),
  /** The patient's acknowledgement of an online consultation's limits (electronic, recorded with the time). */
  acknowledgesOnlineConsultation: z.literal(true, { error: "Please confirm you understand how online consultations work" }),
});

export type Questionnaire = z.infer<typeof questionnaireSchema>;
