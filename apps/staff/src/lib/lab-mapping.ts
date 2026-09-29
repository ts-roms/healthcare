import type { LabFlag, LabTrendPoint } from "@healthcare/domain";
import type {
  LabDashboard,
  LabItemStatus,
  LabOrderItem,
  LabPriority,
  LabReagentUseKind,
  LabReagentUseSummary,
  LabResult,
  LabResultFlag,
  LabResultStatus,
  LabResultType,
  LabSendOut,
  LabSendOutStatus,
  LabTrend,
  LabWorklistStage,
  PatientLabResult,
} from "./api/types";

/**
 * Display rules for laboratory screens. Values, flags and reference ranges
 * come from the API (the range snapshotted when the result was entered);
 * nothing here re-interprets a result.
 */

/** API flags use underscores; the design system's flag vocabulary uses hyphens. */
export function uiFlag(flag: LabResultFlag | null): LabFlag | null {
  if (!flag) return null;
  return flag.replace("_", "-") as LabFlag;
}

export function resultValue(result: Pick<LabResult, "resultType" | "valueNumeric" | "valueText" | "valueCoded">): string {
  switch (result.resultType) {
    case "numeric":
      return result.valueNumeric === null ? "—" : String(result.valueNumeric);
    case "coded":
      return result.valueCoded ?? "—";
    case "text":
      return result.valueText ?? "—";
  }
}

/** "3.9–5.5", "≤ 5.6", "≥ 40", or the laboratory's text range. Empty when no range applied. */
export function referenceText(result: Pick<LabResult, "refLow" | "refHigh" | "refText">): string {
  const { refLow: low, refHigh: high } = result;
  if (low !== null && high !== null) return `${low}–${high}`;
  if (high !== null) return `≤ ${high}`;
  if (low !== null) return `≥ ${low}`;
  return result.refText ?? "";
}

export const PRIORITY_LABEL: Record<LabPriority, string> = { stat: "STAT", scheduled: "Scheduled", routine: "Routine" };

export const ITEM_STATUS_LABEL: Record<LabItemStatus, string> = {
  pending_collection: "To collect",
  collected: "Collected",
  received: "In the lab",
  resulted: "In progress",
  released: "Released",
  cancelled: "Cancelled",
};

export const RESULT_STATUS_LABEL: Record<LabResultStatus, string> = {
  entered: "To verify",
  verified: "To approve",
  approved: "To release",
  released: "Released",
  superseded: "Superseded",
  cancelled: "Cancelled",
};

export interface StageSpec {
  stage: LabWorklistStage;
  label: string;
  /** The permission that lets a user act at this stage (the API enforces it). */
  permission: string;
  count: (d: LabDashboard) => number;
}

export const STAGES: StageSpec[] = [
  { stage: "collect", label: "Collect", permission: "lab.specimen.collect", count: (d) => d.pendingCollection },
  { stage: "receive", label: "Receive", permission: "lab.specimen.receive", count: (d) => d.awaitingReceipt },
  { stage: "enter", label: "Enter results", permission: "lab.result.enter", count: (d) => d.awaitingEntry },
  { stage: "verify", label: "Verify", permission: "lab.result.verify", count: (d) => d.awaitingVerification },
  { stage: "approve", label: "Approve", permission: "lab.result.approve", count: (d) => d.awaitingApproval },
  { stage: "release", label: "Release", permission: "lab.result.release", count: (d) => d.awaitingRelease },
];

export function isStage(value: string | undefined): value is LabWorklistStage {
  return STAGES.some((s) => s.stage === value);
}

/** Items to collect, grouped by the specimen they need (one tube per group). */
export function bySpecimenType(items: LabOrderItem[]): Map<string, LabOrderItem[]> {
  const groups = new Map<string, LabOrderItem[]>();
  for (const item of items) groups.set(item.specimenTypeId, [...(groups.get(item.specimenTypeId) ?? []), item]);
  return groups;
}

export type ParsedValue = { valueNumeric: number } | { valueText: string } | { valueCoded: string };

/** Turns what the technologist typed into the API's value field; the API re-validates (decimals, allowed codes). */
export function parseResultInput(resultType: LabResultType, raw: string): { ok: true; value: ParsedValue } | { ok: false; message: string } {
  const text = raw.trim();
  if (!text) return { ok: false, message: "Enter a value" };
  if (resultType === "numeric") {
    if (!/^-?\d+(\.\d+)?$/.test(text)) return { ok: false, message: "Enter a number (use a dot for decimals)" };
    return { ok: true, value: { valueNumeric: Number(text) } };
  }
  return { ok: true, value: resultType === "coded" ? { valueCoded: text } : { valueText: text } };
}

/** Numeric points for the trend chart, oldest first, dated by collection. */
export function trendPoints(trend: LabTrend): LabTrendPoint[] {
  return trend.points
    .filter((p) => p.valueNumeric !== null)
    .map((p) => ({ date: p.collectedAt ?? p.releasedAt ?? "", value: p.valueNumeric! }))
    .filter((p) => p.date);
}

/** The latest reference range among trend points, to shade the chart (each point keeps its own in the table). */
export function latestRange(trend: LabTrend): { low?: number; high?: number } {
  const last = trend.points.at(-1);
  return { low: last?.refLow ?? undefined, high: last?.refHigh ?? undefined };
}

/** Whether the trend mixes units (e.g. after a method change): the chart would mislead, so show a table instead. */
export function mixedUnits(trend: LabTrend): boolean {
  return new Set(trend.points.map((p) => p.unit ?? "")).size > 1;
}

/** A patient's released results, grouped per test with the latest first. */
export function groupResultsByTest(results: PatientLabResult[]): Array<{ testId: string; testName: string; latest: PatientLabResult; count: number }> {
  const groups = new Map<string, PatientLabResult[]>();
  for (const r of results) groups.set(r.testId, [...(groups.get(r.testId) ?? []), r]);
  return [...groups.entries()]
    .map(([testId, rows]) => {
      const sorted = [...rows].sort((a, b) => sortDate(b) - sortDate(a));
      return { testId, testName: sorted[0]!.testName, latest: sorted[0]!, count: rows.length };
    })
    .sort((a, b) => sortDate(b.latest) - sortDate(a.latest));
}

function sortDate(r: PatientLabResult): number {
  return new Date(r.collectedAt ?? r.releasedAt ?? 0).getTime();
}

/** Minutes past the test's turnaround time since collection; null when not overdue or not applicable. */
export function overdueMinutes(item: Pick<LabOrderItem, "turnaroundMinutes" | "status">, collectedAt: string | null, now: Date): number | null {
  if (!item.turnaroundMinutes || !collectedAt || item.status === "released" || item.status === "cancelled") return null;
  const late = Math.floor((now.getTime() - new Date(collectedAt).getTime()) / 60_000) - item.turnaroundMinutes;
  return late > 0 ? late : null;
}

/** One-line patient identification for worklists: name, number, age in years. */
export function patientLine(patient: { patientNumber: string; displayName: string; sex: string; age: number } | null): string {
  if (!patient) return "Patient";
  return `${patient.displayName} · ${patient.patientNumber} · ${patient.age} y`;
}

// ---- Send-outs to reference laboratories ----------------------------------------------------------

export const SEND_OUT_STATUS_LABEL: Record<LabSendOutStatus, string> = {
  prepared: "To dispatch",
  dispatched: "At the reference laboratory",
  results_received: "Results received",
  rejected: "Rejected by the reference laboratory",
  cancelled: "Send-out cancelled",
};

/** "45 min", "6 h", "2 d 3 h" — elapsed or expected turnaround. */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days} d ${rest} h` : `${days} d`;
}

/** Tone for a send-out's turnaround badge (always shown with an icon and text, never colour alone). */
export function sendOutTone(row: Pick<LabSendOut, "status" | "overdue">): "critical" | "warning" | "info" | "success" | "neutral" {
  if (row.status === "dispatched") return row.overdue ? "critical" : "info";
  if (row.status === "prepared") return "warning";
  if (row.status === "results_received") return "success";
  return "neutral";
}

/** Prepared send-outs grouped by reference laboratory: one dispatch (manifest) per laboratory. */
export function byReferenceLaboratory(rows: LabSendOut[]): Array<{ referenceLaboratoryId: string; name: string; rows: LabSendOut[] }> {
  const groups = new Map<string, { referenceLaboratoryId: string; name: string; rows: LabSendOut[] }>();
  for (const row of rows) {
    const group = groups.get(row.referenceLaboratoryId) ?? { referenceLaboratoryId: row.referenceLaboratoryId, name: row.referenceLaboratoryName, rows: [] };
    group.rows.push(row);
    groups.set(row.referenceLaboratoryId, group);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export const REAGENT_USE_KIND_LABEL: Record<LabReagentUseKind, string> = {
  patient: "Patient run",
  qc: "QC run",
  repeat: "Repeat",
  calibration: "Calibration",
  priming: "Priming",
  waste: "Waste",
  other: "Other",
};

/** "12 of 100 tests used · 88 left", or "12 tests used" when the capacity is not known. */
export function reagentUseText(use: LabReagentUseSummary): string {
  const used = `${use.total} ${use.total === 1 ? "test" : "tests"}`;
  if (use.capacity === null || use.remaining === null) return `${used} used`;
  const left = use.remaining < 0 ? `${-use.remaining} beyond the stated capacity` : `${use.remaining} left`;
  return `${use.total} of ${use.capacity} tests used · ${left}`;
}

/** "86%" (whole percent), or "—". */
export function percent(share: number | null): string {
  return share === null ? "—" : `${Math.round(share * 100)}%`;
}
