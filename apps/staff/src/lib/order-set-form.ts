import type { LabOrderSet } from "./api/types";

/**
 * The order sets screen's wording and input reading (`/laboratory/order-sets`). The API validates and stores; these only
 * turn what is typed into the request and a set back into words.
 */

/** Diagnosis code prefixes typed as "E11, E10 i10": upper case, without repeats; anything but letters, digits, dots and dashes is a separator. */
export function parsePrefixes(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[^A-Za-z0-9.-]+/)
        .map((p) => p.trim().toUpperCase())
        .filter((p) => p.length > 0 && p.length <= 40),
    ),
  ];
}

export type OrderSetTriggerInput = { kind: "diagnosis_code"; value: string; codeSystemKey?: string } | { kind: "visit_type"; value: string };

export function triggersFrom(prefixes: readonly string[], codeSystemKey: string | null, visitTypeCodes: readonly string[]): OrderSetTriggerInput[] {
  return [
    ...prefixes.map((value) => ({ kind: "diagnosis_code" as const, value, ...(codeSystemKey ? { codeSystemKey } : {}) })),
    ...visitTypeCodes.map((value) => ({ kind: "visit_type" as const, value })),
  ];
}

/** When a set is offered, in words: "Diagnoses starting with E11, E10 (ICD-10) · Visit types: Diabetes clinic"; "Chosen by hand only" without triggers. */
export function describeTriggers(set: Pick<LabOrderSet, "triggers">, visitTypeName: (code: string) => string, systemName: (key: string) => string): string {
  const diagnoses = set.triggers.filter((t) => t.kind === "diagnosis_code");
  const visits = set.triggers.filter((t) => t.kind === "visit_type");
  const parts: string[] = [];
  const bySystem = new Map<string | null, string[]>();
  for (const t of diagnoses) bySystem.set(t.codeSystemKey, [...(bySystem.get(t.codeSystemKey) ?? []), t.value]);
  for (const [key, values] of bySystem) parts.push(`Diagnoses starting with ${values.join(", ")}${key ? ` (${systemName(key)})` : ""}`);
  if (visits.length) parts.push(`Visit types: ${visits.map((t) => visitTypeName(t.value)).join(", ")}`);
  return parts.length ? parts.join(" · ") : "Chosen by hand only";
}

/** The set's prefixes as typed back into the field, its one coding system (or null) and its visit types. */
export function formValues(set: Pick<LabOrderSet, "triggers">): { prefixes: string; codeSystemKey: string | null; visitTypeCodes: string[] } {
  const diagnoses = set.triggers.filter((t) => t.kind === "diagnosis_code");
  const systems = [...new Set(diagnoses.map((t) => t.codeSystemKey))];
  return {
    prefixes: diagnoses.map((t) => t.value).join(", "),
    codeSystemKey: systems.length === 1 ? (systems[0] ?? null) : null,
    visitTypeCodes: set.triggers.filter((t) => t.kind === "visit_type").map((t) => t.value),
  };
}
