import type { CaseReportStatus } from "./doh.schema";

/**
 * DOH case reporting — the platform's own rules only. Which conditions are
 * reportable, their case definitions, deadlines and the official formats come
 * from DOH issuances the organization follows; none of that is encoded here.
 */

/** Coding-system keys organizations use for ICD-10 (the key is their own configuration). */
const ICD10_KEYS = new Set(["icd-10", "icd10"]);

export function isIcd10(codeSystemKey: string | null): boolean {
  return !!codeSystemKey && ICD10_KEYS.has(codeSystemKey.toLowerCase());
}

/** "a90 " → "A90"; "a91.0" → "A91.0". */
export function normalizeCode(code: string): string {
  return code.replace(/\s+/g, "").toUpperCase();
}

/**
 * The most specific active rule whose prefix the code starts with: "A9" covers A90–A99, "A91" covers A91 and A91.x,
 * "A01.0" only A01.0x. The longest matching prefix wins.
 */
export function matchRule<R extends { codePrefix: string; status: string }>(rules: R[], code: string): R | undefined {
  const normalized = normalizeCode(code);
  return rules.filter((r) => r.status === "active" && normalized.startsWith(r.codePrefix)).sort((a, b) => b.codePrefix.length - a.codePrefix.length)[0];
}

/** The longest date range one check of earlier diagnoses may cover (calendar days, both ends included). */
export const MAX_RESCAN_DAYS = 90;

/** Why a check of earlier diagnoses cannot cover this range (dates YYYY-MM-DD, `today` in the same time zone), or null. */
export function rescanRangeProblem(from: string, to: string, today: string): string | null {
  if (from > to) return "The start date is after the end date";
  if (to > today) return "The range cannot end in the future";
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (days > MAX_RESCAN_DAYS) return `A check covers at most ${MAX_RESCAN_DAYS} days; split the range`;
  return null;
}

type Action = "record_external" | "dismiss" | "submit" | "queue_result";

const ALLOWED: Record<Action, CaseReportStatus[]> = {
  // Reported through DOH's own channel: possible while nothing else has succeeded.
  record_external: ["pending_review", "rejected", "failed"],
  dismiss: ["pending_review", "rejected", "failed"],
  submit: ["pending_review", "rejected", "failed"],
  queue_result: ["queued"],
};

export function canApply(action: Action, status: CaseReportStatus): boolean {
  return ALLOWED[action].includes(status);
}

/** What the platform gathers for one case (from the diagnosis, its encounter, the patient and the facility). */
export interface DohCaseSource {
  diagnosis: {
    id: string;
    encounterId: string;
    codeSystemKey: string | null;
    code: string | null;
    display: string;
    certainty: "provisional" | "confirmed" | "refuted";
    status: "active" | "resolved" | "entered_in_error";
    recordedAt: string;
  };
  encounter: { id: string; facilityId: string; facilityName: string; startedAt: string; modality: string; practitionerName: string | null };
  patient: {
    id: string;
    patientNumber: string;
    familyName: string;
    givenName: string;
    middleName: string | null;
    suffix: string | null;
    sex: string;
    birthDate: string;
    address: { line1: string | null; barangay: string | null; cityMunicipality: string; province: string | null; region: string | null } | null;
    contactNumber: string | null;
  };
}

/**
 * The platform's format-neutral view of one case report. NOT an official DOH
 * form or message: an adapter maps it once the specification is obtained.
 */
export interface DohCasePackage {
  model: "platform-case-1";
  caseReportId: string;
  category: string;
  facility: { id: string; name: string; facilityCode: string | null };
  patient: DohCaseSource["patient"];
  diagnosis: { codeSystem: "icd-10"; code: string; display: string; certainty: string; recordedAt: string };
  consultation: { date: string; modality: string; clinician: string | null };
}

export type CaseReadinessCode = "diagnosis_not_valid" | "facility_code_missing" | "patient_address_missing";

export interface CaseReadinessCheck {
  code: CaseReadinessCode;
  ok: boolean;
  message: string;
}

/** Completeness of the platform's own data; the official required fields come with the specification. */
export function caseReadiness(src: DohCaseSource, facilityCode: string | null): CaseReadinessCheck[] {
  return [
    {
      code: "diagnosis_not_valid",
      ok: src.diagnosis.status !== "entered_in_error" && src.diagnosis.certainty !== "refuted",
      message: "The diagnosis stands (not entered in error or refuted)",
    },
    { code: "facility_code_missing", ok: !!facilityCode, message: "The facility's DOH health facility code is recorded" },
    { code: "patient_address_missing", ok: !!src.patient.address?.cityMunicipality, message: "The patient's address (city or municipality) is recorded" },
  ];
}

export function buildCasePackage(caseReport: { id: string; category: string }, src: DohCaseSource, facilityCode: string | null): DohCasePackage {
  if (!src.diagnosis.code) throw new Error("A case package needs a coded diagnosis");
  return {
    model: "platform-case-1",
    caseReportId: caseReport.id,
    category: caseReport.category,
    facility: { id: src.encounter.facilityId, name: src.encounter.facilityName, facilityCode },
    patient: src.patient,
    diagnosis: {
      codeSystem: "icd-10",
      code: normalizeCode(src.diagnosis.code),
      display: src.diagnosis.display,
      certainty: src.diagnosis.certainty,
      recordedAt: src.diagnosis.recordedAt,
    },
    consultation: { date: src.encounter.startedAt, modality: src.encounter.modality, clinician: src.encounter.practitionerName },
  };
}

/**
 * When a case report is due under the organization's own rule: the diagnosis time plus the rule's days. Null when the
 * rule sets no deadline (the platform encodes none).
 */
export function caseReportDueAt(diagnosisRecordedAt: string | Date, reportWithinDays: number | null | undefined): Date | null {
  if (!reportWithinDays) return null;
  return new Date(new Date(diagnosisRecordedAt).getTime() + reportWithinDays * 86_400_000);
}

/** Still waiting to be reported (or retried) and past the organization's own deadline. */
export function caseReportOverdue(report: { status: string; dueAt: Date | null }, now: Date = new Date()): boolean {
  return report.dueAt !== null && ["pending_review", "queued", "failed", "rejected"].includes(report.status) && report.dueAt < now;
}
