import { type RuleDefinition, type Suggestion, suggestionId } from "@healthcare/core";
import { z } from "zod";

/**
 * Rule `clinic.encounter-checklist` (docs/domains/assistant.md): before a consultation in progress is signed, what the
 * record does not yet hold — a chief complaint, vital signs (in person), an assessment and a plan, a diagnosis, a code
 * for each diagnosis and a primary one, and the allergy review. It is a reminder about the record, never about the
 * patient's care, and it blocks nothing: the doctor signs whenever they decide. Which checks apply is the
 * organization's choice (a 1 or 0 parameter each).
 */

export const encounterChecklistParameters = z.object({
  /** Vital signs taken within this many hours before now (for the visit or the patient) count. */
  vitalsWithinHours: z.number().int().min(1).max(72),
  /** 1: check vital signs for in-person consultations; 0: skip. */
  checkVitals: z.number().int().min(0).max(1),
  /** 1: check that diagnoses carry a code (when the organization has an active coding system); 0: skip. */
  checkCoding: z.number().int().min(0).max(1),
});
export type EncounterChecklistParameters = z.infer<typeof encounterChecklistParameters>;

export const ENCOUNTER_CHECKLIST_RULE: RuleDefinition<EncounterChecklistParameters> = {
  id: "clinic.encounter-checklist",
  version: 1,
  domain: "clinic",
  title: "Before signing: what the record does not hold yet",
  description:
    "Lists what a consultation in progress is still missing before it is signed: chief complaint, vital signs, assessment and plan, a diagnosis, its code and the allergy review. It blocks nothing.",
  surfaces: ["encounter"],
  requires: ["encounter.read"],
  parametersSchema: encounterChecklistParameters,
  defaultParameters: { vitalsWithinHours: 24, checkVitals: 1, checkCoding: 1 },
  parameterLabels: {
    checkVitals: { label: "Check vital signs (1 = yes, 0 = no)", min: 0, max: 1, hint: "In-person consultations only." },
    vitalsWithinHours: { label: "Vital signs count when taken within", unit: "hours", min: 1, max: 72 },
    checkCoding: {
      label: "Check diagnosis codes (1 = yes, 0 = no)",
      min: 0,
      max: 1,
      hint: "Only when your organization has an active coding system.",
    },
  },
};

export interface EncounterChecklistInput {
  encounterId: string;
  inPerson: boolean;
  hasChiefComplaint: boolean;
  hasVitals: boolean;
  hasAssessment: boolean;
  hasPlan: boolean;
  /** Active diagnoses of the consultation. */
  diagnoses: Array<{ coded: boolean; primary: boolean }>;
  /** An allergy review is recorded, or an active allergy is. */
  allergiesReviewed: boolean;
  /** The organization has an active coding system. */
  codingAvailable: boolean;
}

/** The items still missing, in the order a doctor works. */
export function missingItems(input: EncounterChecklistInput, params: EncounterChecklistParameters): string[] {
  const missing: string[] = [];
  if (!input.hasChiefComplaint) missing.push("Chief complaint");
  if (params.checkVitals === 1 && input.inPerson && !input.hasVitals) missing.push(`Vital signs (none in the last ${params.vitalsWithinHours} hours)`);
  if (!input.allergiesReviewed) missing.push("Allergy review");
  if (!input.hasAssessment) missing.push("Assessment");
  if (!input.hasPlan) missing.push("Plan");
  if (input.diagnoses.length === 0) missing.push("A diagnosis");
  else {
    const uncoded = input.diagnoses.filter((d) => !d.coded).length;
    if (params.checkCoding === 1 && input.codingAvailable && uncoded > 0) missing.push(`A code for ${uncoded} ${uncoded === 1 ? "diagnosis" : "diagnoses"}`);
    if (!input.diagnoses.some((d) => d.primary)) missing.push("A primary diagnosis");
  }
  return missing;
}

export function encounterChecklistSuggestions(input: EncounterChecklistInput | null, params: EncounterChecklistParameters): Suggestion[] {
  if (!input) return [];
  const missing = missingItems(input, params);
  if (missing.length === 0) return [];
  return [
    {
      id: suggestionId(ENCOUNTER_CHECKLIST_RULE.id, ENCOUNTER_CHECKLIST_RULE.version, `encounter:${input.encounterId}`),
      ruleId: ENCOUNTER_CHECKLIST_RULE.id,
      ruleVersion: ENCOUNTER_CHECKLIST_RULE.version,
      surface: "encounter",
      severity: "advice",
      title: `Before signing: ${missing.length} ${missing.length === 1 ? "item" : "items"} not recorded yet`,
      rationale: `${missing.join(", ")}. Add them if they apply; you can sign without them.`,
      evidence: missing.map((item) => ({ label: item, resourceType: "encounter", resourceId: input.encounterId, value: "Not recorded" })),
      basis: "rule",
      strength: "matched",
      requires: [...ENCOUNTER_CHECKLIST_RULE.requires],
    },
  ];
}
