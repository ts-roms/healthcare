import { sha256Hex } from "@healthcare/core";

/** What a review found when it read a document back from storage. */
export type IntegrityOutcome = "verified" | "baselined" | "mismatch" | "missing" | "unreadable";

/** The bytes storage returned, or that it returned none, or that it did not answer. */
export type StoredBytes = { kind: "bytes"; bytes: Buffer } | { kind: "missing" } | { kind: "unreadable" };

export type IntegrityCheck = {
  outcome: IntegrityOutcome;
  /** The hash of the bytes found; null when there were none. */
  computedSha256: string | null;
};

/**
 * Compares a document's stored bytes with its recorded hash (migration 0105). A document without a recorded hash
 * (stored before 0098) is baselined: its current hash is recorded, which establishes a baseline and verifies nothing.
 * Storage that did not answer is `unreadable`: nothing is concluded about the document, and the run moves on.
 */
export function checkIntegrity(recordedSha256: string | null, stored: StoredBytes): IntegrityCheck {
  if (stored.kind === "unreadable") return { outcome: "unreadable", computedSha256: null };
  if (stored.kind === "missing") return { outcome: "missing", computedSha256: null };
  const computedSha256 = sha256Hex(stored.bytes);
  if (recordedSha256 === null) return { outcome: "baselined", computedSha256 };
  return { outcome: recordedSha256 === computedSha256 ? "verified" : "mismatch", computedSha256 };
}

/** Whether an outcome refuses the document to readers until the records office resolves the finding. */
export function blocksServing(outcome: IntegrityOutcome | "verified" | null | undefined): boolean {
  return outcome === "mismatch" || outcome === "missing";
}

export type IntegrityCounts = {
  checked: number;
  verified: number;
  baselined: number;
  mismatched: number;
  missing: number;
  unreadable: number;
};

export const EMPTY_COUNTS: IntegrityCounts = { checked: 0, verified: 0, baselined: 0, mismatched: 0, missing: 0, unreadable: 0 };

/** Adds one outcome to a run's counts (`checked` is always the sum of the others). */
export function countOutcome(counts: IntegrityCounts, outcome: IntegrityOutcome): IntegrityCounts {
  const key = outcome === "mismatch" ? "mismatched" : outcome;
  return { ...counts, checked: counts.checked + 1, [key]: counts[key] + 1 };
}
