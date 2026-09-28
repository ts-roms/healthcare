import { type DentalChart, sortSurfaces, TOOTH_CONDITION_META, type ToothState } from "@healthcare/domain";
import type { DentalChartTooth, DentalImageKind, DentalPlanItemStatus, DentalPlanStatus, DentalProcedureSite, DentalVisit } from "./api/types";

type Variant = "success" | "warning" | "danger" | "neutral" | "info" | "teal";

/** The API's chart (a list of charted teeth) as the odontogram's record. */
export function toChart(teeth: readonly Pick<DentalChartTooth, "tooth" | "findings" | "note">[]): DentalChart {
  return Object.fromEntries(teeth.map((t) => [t.tooth, { tooth: t.tooth, findings: t.findings, note: t.note }]));
}

function sameState(a: ToothState | undefined, b: ToothState | undefined): boolean {
  const key = (s: ToothState | undefined) =>
    s ? JSON.stringify([s.findings.map((f) => [f.condition, sortSurfaces(f.surfaces)]).sort(), (s.note ?? "").trim()]) : "";
  return key(a) === key(b);
}

/** Teeth whose charted state in the draft differs from the current chart. */
export function changedTeeth(current: DentalChart, draft: DentalChart): Set<string> {
  return new Set(Object.keys(draft).filter((tooth) => !sameState(current[tooth], draft[tooth])));
}

/** Problems the API would reject, shown before sending (surface conditions without surfaces). */
export function draftProblems(draft: DentalChart, teeth: Iterable<string>): string[] {
  const problems: string[] = [];
  for (const tooth of teeth) {
    for (const f of draft[tooth]?.findings ?? []) {
      if (TOOTH_CONDITION_META[f.condition].site === "surfaces" && f.surfaces.length === 0) {
        problems.push(`Tooth ${tooth}: choose the ${TOOTH_CONDITION_META[f.condition].label.toLowerCase()} surfaces.`);
      }
    }
  }
  return problems;
}

/** The examination's charted teeth: the changed teeth only (the others keep their previous state). */
export function examinationTeeth(draft: DentalChart, teeth: Iterable<string>) {
  return [...teeth].sort().map((tooth) => ({
    tooth,
    findings: (draft[tooth]?.findings ?? []).map((f) => ({ condition: f.condition, surfaces: sortSurfaces(f.surfaces) })),
    ...(draft[tooth]?.note?.trim() ? { note: draft[tooth]!.note!.trim() } : {}),
  }));
}

export const PLAN_STATUS: Record<DentalPlanStatus, { label: string; variant: Variant }> = {
  proposed: { label: "Proposed — awaiting the patient's decision", variant: "info" },
  accepted: { label: "Accepted", variant: "teal" },
  in_progress: { label: "In progress", variant: "teal" },
  completed: { label: "Completed", variant: "success" },
  declined: { label: "Declined", variant: "neutral" },
  discontinued: { label: "Discontinued", variant: "neutral" },
};

export const PLAN_ITEM_STATUS: Record<DentalPlanItemStatus, { label: string; variant: Variant }> = {
  proposed: { label: "Proposed", variant: "info" },
  accepted: { label: "Accepted", variant: "teal" },
  declined: { label: "Declined", variant: "neutral" },
  completed: { label: "Done", variant: "success" },
  cancelled: { label: "Cancelled", variant: "neutral" },
};

export const IMAGE_KINDS: Record<DentalImageKind, string> = {
  periapical: "Periapical",
  bitewing: "Bitewing",
  panoramic: "Panoramic",
  cephalometric: "Cephalometric",
  occlusal: "Occlusal",
  cbct: "CBCT",
  intraoral_photo: "Intraoral photo",
  extraoral_photo: "Extraoral photo",
  other: "Other",
};

export const PROCEDURE_SITES: Record<DentalProcedureSite, string> = {
  mouth: "Whole mouth",
  tooth: "Tooth",
  surface: "Tooth surfaces",
};

export const HYGIENE = { good: "Good", fair: "Fair", poor: "Poor" } as const;

/** The dental visit in progress for this patient (the one to record into), if any. */
export function openVisit(visits: readonly DentalVisit[], patientId: string): DentalVisit | undefined {
  return visits.find((v) => v.patientId === patientId && v.status === "in_progress");
}
