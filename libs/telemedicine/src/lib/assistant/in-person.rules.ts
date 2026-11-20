import { localDate, type RuleDefinition, type Suggestion, type SuggestionEvidence, suggestionId } from "@healthcare/core";
import { z } from "zod";
import { RED_FLAGS, type RedFlag } from "../questionnaire";

/**
 * `telemedicine.in-person-care` (docs/domains/assistant.md, phase 3 — "an escalation hint from questionnaire answers"):
 * in an online consultation in progress, reasons the patient may need to be seen in person — red flags ticked in the
 * pre-consult questionnaire (the questionnaire's fixed list), symptoms the patient said have lasted long, many online
 * consultations in a short time, or no in-person consultation for months. Clinical decision support (CLAUDE.md §35):
 * the doctor decides and escalates from the online consultation panel; nothing is changed or escalated by the rule.
 */

export const inPersonParameters = z.object({
  /** This many online consultations of the patient in `onlineDays` (this one included). */
  onlineCount: z.number().int().min(2).max(20),
  onlineDays: z.number().int().min(7).max(180),
  /** No in-person consultation in this many months (0: not checked). */
  inPersonMonths: z.number().int().min(0).max(36),
  /** Symptoms the patient said have lasted at least this many days (0: not checked). */
  symptomDays: z.number().int().min(0).max(365),
});
export type InPersonParameters = z.infer<typeof inPersonParameters>;

export const IN_PERSON_RULE: RuleDefinition<InPersonParameters> = {
  id: "telemedicine.in-person-care",
  version: 1,
  domain: "telemedicine",
  title: "Consider seeing the patient in person",
  description:
    "In an online consultation in progress: the patient ticked red flags in the pre-consult questionnaire, said the symptoms have lasted the days you set, has had the number of online consultations you set in a short time, or has not had an in-person consultation for the months you set. The doctor decides whether to escalate to in-person care; nothing is changed.",
  surfaces: ["encounter"],
  requires: ["encounter.read", "telemedicine.read"],
  parametersSchema: inPersonParameters,
  defaultParameters: { onlineCount: 3, onlineDays: 30, inPersonMonths: 12, symptomDays: 14 },
  parameterLabels: {
    onlineCount: { label: "Online consultations, this one included, at least", unit: "consultations", min: 2, max: 20 },
    onlineDays: { label: "…within", unit: "days", min: 7, max: 180 },
    inPersonMonths: { label: "No in-person consultation for", unit: "months", min: 0, max: 36, hint: "0 turns this check off." },
    symptomDays: { label: "Symptoms the patient said have lasted at least", unit: "days", min: 0, max: 365, hint: "0 turns this check off." },
  },
};

export interface InPersonInput {
  encounterId: string;
  /** ISO instant the check reads at. */
  asOf: string;
  timeZone: string;
  /** Red flags the patient ticked in the pre-consult questionnaire submitted by the moment. */
  redFlags: string[];
  /** The patient's answer: for how many days the symptoms have lasted, if given. */
  symptomDurationDays: number | null;
  /** The patient's online consultations started in the `onlineDays` before the moment, this one included (linked records too). */
  onlineConsultations: number;
  /** When the patient's last in-person consultation started (ISO), if any before the moment. */
  lastInPersonAt: string | null;
  /** When the patient's vital signs were last measured (ISO), if any before the moment. */
  lastVitalsAt: string | null;
}

const MONTH_MS = 30 * 86_400_000;

export function inPersonSuggestions(input: InPersonInput, params: InPersonParameters): Suggestion[] {
  const day = (iso: string) => localDate(new Date(iso), input.timeZone);
  const reasons: string[] = [];
  const evidence: SuggestionEvidence[] = [];
  const flags = input.redFlags.map((f) => RED_FLAGS[f as RedFlag] ?? f);
  if (flags.length > 0) {
    reasons.push(`${flags.length} red flag${flags.length === 1 ? "" : "s"} ticked`);
    for (const flag of flags) evidence.push({ label: "Red flag ticked by the patient", resourceType: "encounter", resourceId: input.encounterId, value: flag });
  }
  if (params.symptomDays > 0 && input.symptomDurationDays !== null && input.symptomDurationDays >= params.symptomDays) {
    reasons.push(`symptoms for ${input.symptomDurationDays} days`);
    evidence.push({
      label: "Symptoms lasted (the patient's answer)",
      resourceType: "encounter",
      resourceId: input.encounterId,
      value: `${input.symptomDurationDays} days`,
    });
  }
  if (input.onlineConsultations >= params.onlineCount) {
    reasons.push(`${input.onlineConsultations} online consultations in ${params.onlineDays} days`);
  }
  const lastInPerson = input.lastInPersonAt ? Date.parse(input.lastInPersonAt) : null;
  if (params.inPersonMonths > 0 && (lastInPerson === null || Date.parse(input.asOf) - lastInPerson > params.inPersonMonths * MONTH_MS)) {
    reasons.push(lastInPerson === null ? "never seen in person here" : `not seen in person since ${day(input.lastInPersonAt!)}`);
  }
  if (reasons.length === 0) return [];
  evidence.push(
    {
      label: `Online consultations in ${params.onlineDays} days`,
      resourceType: "encounter",
      resourceId: input.encounterId,
      value: `${input.onlineConsultations} (this one included)`,
    },
    {
      label: "Last in-person consultation",
      resourceType: "encounter",
      resourceId: input.encounterId,
      value: input.lastInPersonAt ? day(input.lastInPersonAt) : "none recorded here",
    },
    {
      label: "Last vital signs",
      resourceType: "encounter",
      resourceId: input.encounterId,
      value: input.lastVitalsAt ? day(input.lastVitalsAt) : "none recorded here",
    },
  );
  return [
    {
      id: suggestionId(IN_PERSON_RULE.id, IN_PERSON_RULE.version, `encounter:${input.encounterId}`),
      ruleId: IN_PERSON_RULE.id,
      ruleVersion: IN_PERSON_RULE.version,
      surface: "encounter",
      severity: flags.length > 0 ? "warning" : "advice",
      title: `Consider seeing the patient in person: ${reasons.join("; ")}`,
      rationale:
        "An online consultation cannot examine the patient or measure vital signs." +
        (flags.length > 0 ? ` In the pre-consult questionnaire the patient ticked: ${flags.join("; ")}.` : "") +
        " If the patient should be seen in person, use Escalate to in-person care in the online consultation panel; the decision is yours.",
      evidence,
      basis: "rule",
      strength: "matched",
      requires: [...IN_PERSON_RULE.requires],
    },
  ];
}
