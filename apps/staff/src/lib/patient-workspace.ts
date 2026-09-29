import type { Encounter, Medication, Problem } from "@healthcare/domain";
import type {
  AllergySummary,
  LabTrend,
  PatientDetail,
  PatientLabResult,
  PatientWorkspace,
  PatientWorkspacePanel,
  WorkspaceCarePlan,
  WorkspaceEncounter,
  WorkspacePrescription,
} from "./api/types";
import { groupResultsByTest } from "./lab-mapping";
import { currentConsents, label } from "./patient-mapping";
import { FREQUENCY_LABEL } from "./prescription-form";

/**
 * Presentation rules of the Patient 360 workspace (/patients/[id]/360). The API decides what each user may see; these
 * helpers only word, order and bound it. Nothing here invents clinical data: an absent panel is "not available to
 * you", never "none".
 */

// ---- Access -----------------------------------------------------------------------------------------------------

/** The panels the workspace page asks for, and the permission each needs (the API enforces the same). */
export const WORKSPACE_PAGE_PANELS = {
  clinical: ["patient.read", "clinical.read"],
  prescriptions: ["prescription.read"],
  carePlans: ["care-plan.read"],
  labResults: ["lab.result.read"],
  timeline: ["patient.read"],
} as const satisfies Record<string, readonly string[]>;

export type WorkspacePagePanel = keyof typeof WORKSPACE_PAGE_PANELS;

/** Which page-level panels the user may load (the rest render a short "not available to you" note). */
export function workspaceAccess(permissions: readonly string[]): Record<WorkspacePagePanel, boolean> {
  const has = new Set(permissions);
  return Object.fromEntries(
    (Object.keys(WORKSPACE_PAGE_PANELS) as WorkspacePagePanel[]).map((panel) => [panel, WORKSPACE_PAGE_PANELS[panel].every((p) => has.has(p))]),
  ) as Record<WorkspacePagePanel, boolean>;
}

/** Whether the API withheld one of the workspace endpoint's panels (or the whole workspace could not be loaded). */
export function isWithheld(workspace: Pick<PatientWorkspace, "withheld"> | null, panel: PatientWorkspacePanel): boolean {
  return !workspace || workspace.withheld.includes(panel);
}

export const WITHHELD_TEXT = "Not available to you.";

// ---- Banner -----------------------------------------------------------------------------------------------------

export type AllergyStatement =
  | { state: "no_access"; text: "Allergies: no access" }
  | { state: "not_recorded"; text: "Allergies not recorded — ask the patient" }
  | { state: "no_known"; text: "No known allergies" }
  | { state: "recorded"; text: string };

/**
 * The allergy line's wording. "No known allergies" only after a recorded review; never reviewed reads "not recorded";
 * a user without clinical access gets no allergy statement at all.
 */
export function allergyStatement(summary: Pick<AllergySummary, "status" | "allergies"> | null | undefined): AllergyStatement {
  if (!summary) return { state: "no_access", text: "Allergies: no access" };
  if (summary.status === "not_reviewed" && summary.allergies.length === 0) return { state: "not_recorded", text: "Allergies not recorded — ask the patient" };
  if (summary.status === "no_known_allergies" && summary.allergies.length === 0) return { state: "no_known", text: "No known allergies" };
  const n = summary.allergies.length;
  return { state: "recorded", text: `${n} allerg${n === 1 ? "y" : "ies"} recorded` };
}

/** Masks an identifier to its last four digits, keeping separators: "12-345678901-2" → "••-••••••901-2". */
export function maskIdentifier(value: string, visible = 4): string {
  const digits = value.replace(/\D/g, "").length;
  let seen = 0;
  return value.replace(/[0-9A-Za-z]/g, (c) => (++seen > digits - visible && /\d/.test(c) ? c : "•"));
}

/** The patient's PhilHealth PIN, masked; null when none is recorded. */
export function maskedPhilHealthPin(patient: Pick<PatientDetail, "identifiers">): string | null {
  const pin = patient.identifiers.find((i) => i.type === "philhealth_pin");
  return pin ? maskIdentifier(pin.value) : null;
}

// ---- Alerts -----------------------------------------------------------------------------------------------------

export interface WorkspaceAlert {
  key: string;
  /** Drives icon and colour together with the text (never colour alone). */
  tone: "critical" | "warning" | "info";
  text: string;
  href?: string;
}

/**
 * The alerts strip under the banner: the record's status, critical results awaiting acknowledgement, chronic
 * problems and consent decisions that change what staff may do. Allergies are on the banner itself.
 */
export function deriveAlerts(input: {
  patient: Pick<PatientDetail, "status" | "consents">;
  problems: Array<{ code: string | null; display: string; isChronic: boolean }> | null;
  criticalResults: PatientWorkspace["criticalResults"];
}): WorkspaceAlert[] {
  const alerts: WorkspaceAlert[] = [];
  if (input.patient.status !== "active") alerts.push({ key: "status", tone: "warning", text: `Record status: ${label(input.patient.status)}` });
  for (const c of input.criticalResults ?? []) {
    alerts.push({
      key: `critical:${c.id}`,
      tone: "critical",
      text: `Critical result awaiting acknowledgement: ${c.testName} (${c.orderNumber}) — ${c.status === "communicated" ? "communicated, not yet acknowledged" : "not yet communicated"}`,
      href: "/laboratory/critical",
    });
  }
  const chronic = (input.problems ?? []).filter((p) => p.isChronic);
  if (chronic.length) {
    alerts.push({ key: "chronic", tone: "info", text: `Chronic: ${chronic.map((p) => [p.code, p.display].filter(Boolean).join(" ")).join("; ")}` });
  }
  const consents = new Map(currentConsents(input.patient.consents).map((c) => [c.consentType, c.decision]));
  for (const type of ["treatment_general", "data_processing", "telemedicine"]) {
    const decision = consents.get(type);
    if (decision === "refused" || decision === "withdrawn")
      alerts.push({ key: `consent:${type}`, tone: "warning", text: `${label(type)} consent ${decision}` });
  }
  if (consents.get("portal_access") !== "granted") alerts.push({ key: "consent:portal_access", tone: "info", text: "No patient portal (MyHealth) consent" });
  return alerts;
}

// ---- Panels -----------------------------------------------------------------------------------------------------

/** Active prescription items as the design system's medication list: prescriber, number and date alongside. */
export function toMedications(prescriptions: readonly WorkspacePrescription[]): Medication[] {
  return prescriptions.flatMap((rx) =>
    rx.items.map((i) => ({
      id: i.id,
      name: [i.genericName, i.brandName ? `(${i.brandName})` : null].filter(Boolean).join(" "),
      dose: [i.strength, i.dosageForm].filter(Boolean).join(" "),
      frequency:
        i.frequency === "custom" ? (i.frequencyText ?? "") : (FREQUENCY_LABEL[i.frequency as keyof typeof FREQUENCY_LABEL] ?? label(i.frequency)).toLowerCase(),
      startedOn: rx.issuedAt,
      prescriber: [rx.prescriberName, rx.prescriptionNumber].filter(Boolean).join(" · "),
      status: "active" as const,
    })),
  );
}

/** Problems as the design system's problem list (active ones; chronic first as the API sorts them). */
export function toProblems(problems: ReadonlyArray<{ id: string; code: string | null; display: string; isChronic: boolean }>): Problem[] {
  return problems.map((p) => ({ id: p.id, code: p.code ?? undefined, description: p.isChronic ? `${p.display} (chronic)` : p.display, status: "active" }));
}

/** "E11.9 Type 2 diabetes mellitus, I10 …" or "No diagnosis recorded". */
export function diagnosisLine(diagnoses: WorkspaceEncounter["diagnoses"]): string {
  if (!diagnoses.length) return "No diagnosis recorded";
  return diagnoses.map((d) => [d.code, d.display].filter(Boolean).join(" ")).join(", ");
}

/** Recent consultations as the design system's encounter history. */
export function toEncounterHistory(encounters: readonly WorkspaceEncounter[]): Encounter[] {
  return encounters.map((e) => ({
    id: e.id,
    patientId: "",
    type: e.modality === "telemedicine" ? "telemedicine" : "consultation",
    status: e.status === "in_progress" ? "in-progress" : e.status === "completed" ? "completed" : "cancelled",
    date: e.startedAt,
    provider: e.practitionerName,
    facility: e.facility?.name ?? "",
    reason: [e.visitTypeName, diagnosisLine(e.diagnoses)].filter(Boolean).join(" · "),
  }));
}

/** The next open activity with a due date, and whether it is overdue on `today` (the facility's local date). */
export function nextActivity(
  plan: Pick<WorkspaceCarePlan, "openActivities">,
  today: string,
): { description: string; dueDate: string; overdue: boolean } | null {
  const due = plan.openActivities.filter((a): a is typeof a & { dueDate: string } => !!a.dueDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  return due ? { description: due.description, dueDate: due.dueDate, overdue: due.dueDate < today } : null;
}

// ---- Laboratory -------------------------------------------------------------------------------------------------

/**
 * The patient's most relevant tests for the workspace, at most `limit`: latest value critical, then abnormal, then
 * tests with a history (a trend), then the most recent — ties keep the latest first.
 */
export function relevantTests(results: readonly PatientLabResult[], limit: number): string[] {
  const groups = groupResultsByTest([...results]);
  const score = (g: (typeof groups)[number]) =>
    (g.latest.critical ? 0 : g.latest.flag && g.latest.flag !== "normal" ? 1 : 2) * 2 + (g.count > 1 && g.latest.resultType === "numeric" ? 0 : 1);
  return groups
    .map((g, index) => ({ g, index }))
    .sort((a, b) => score(a.g) - score(b.g) || a.index - b.index)
    .slice(0, limit)
    .map(({ g }) => g.testId);
}

/** A trend of one test from the released results already loaded (same test only; the full trend lines up equivalent tests). */
export function trendFromResults(results: readonly PatientLabResult[], testId: string): LabTrend | null {
  const rows = results
    .filter((r) => r.testId === testId && r.resultType === "numeric" && r.valueNumeric !== null)
    .sort((a, b) => (a.collectedAt ?? a.releasedAt ?? "").localeCompare(b.collectedAt ?? b.releasedAt ?? ""));
  const last = rows.at(-1);
  if (!last || rows.length < 2) return null;
  return {
    analyte: last.testCode,
    testName: last.testName,
    unit: last.unit,
    points: rows.map((r) => ({
      resultId: r.id,
      collectedAt: r.collectedAt,
      releasedAt: r.releasedAt,
      testCode: r.testCode,
      valueNumeric: r.valueNumeric,
      valueText: r.valueText,
      valueCoded: r.valueCoded,
      unit: r.unit,
      flag: r.flag,
      critical: r.critical,
      refLow: r.refLow,
      refHigh: r.refHigh,
      refText: r.refText,
      corrected: r.versionNumber > 1,
    })),
  };
}
