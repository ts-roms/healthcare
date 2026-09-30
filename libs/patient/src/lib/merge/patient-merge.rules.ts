/**
 * Patient merge rules ("link, don't move", ADR-0009). Pure functions, unit-tested: which pairs may be merged, which
 * differences staff must acknowledge, and which work in progress blocks a merge. The service supplies the facts.
 */

export interface MergeCandidateFacts {
  id: string;
  organizationId: string;
  patientNumber: string;
  familyName: string;
  givenName: string;
  middleName: string | null;
  suffix: string | null;
  sex: string;
  birthDate: string;
  status: string;
  mergedIntoPatientId: string | null;
}

export interface MergeIdentifierFacts {
  type: string;
  issuer: string | null;
  valueNormalized: string;
}

/** Why a pair cannot be merged at all (independent of work in progress). */
export type MergeIneligibility = "same_record" | "different_organization" | "retired_already_merged" | "survivor_merged";

export function mergeIneligibility(retired: MergeCandidateFacts, survivor: MergeCandidateFacts): MergeIneligibility | undefined {
  if (retired.id === survivor.id) return "same_record";
  if (retired.organizationId !== survivor.organizationId) return "different_organization";
  if (retired.status === "merged" || retired.mergedIntoPatientId) return "retired_already_merged";
  if (survivor.status === "merged" || survivor.mergedIntoPatientId) return "survivor_merged";
  return undefined;
}

export const MERGE_INELIGIBILITY_MESSAGES: Record<MergeIneligibility, string> = {
  same_record: "Choose two different records",
  different_organization: "Both records must belong to the same organization",
  retired_already_merged: "This record is already merged into another patient",
  survivor_merged: "The record chosen to survive is itself merged; choose the record it was merged into",
};

/** A difference between the two records that staff must acknowledge before merging. */
export type MergeDifferenceCode = "family_name" | "given_name" | "middle_name" | "suffix" | "birth_date" | "sex" | "deceased_status" | `identifier:${string}`;

export interface MergeDifference {
  code: MergeDifferenceCode;
  field: string;
  retired: string | null;
  survivor: string | null;
}

const norm = (value: string | null | undefined) =>
  (value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();

/**
 * Differences flagged for review: names, birth date, sex, a deceased/not-deceased mismatch, and identifiers of the same
 * type (and issuer) with different values — the two records may be different people.
 */
export function mergeDifferences(
  retired: MergeCandidateFacts,
  survivor: MergeCandidateFacts,
  identifiers: { retired: MergeIdentifierFacts[]; survivor: MergeIdentifierFacts[] },
): MergeDifference[] {
  const differences: MergeDifference[] = [];
  const text = (code: MergeDifferenceCode, field: string, a: string | null, b: string | null) => {
    if (norm(a) !== norm(b)) differences.push({ code, field, retired: a, survivor: b });
  };
  text("family_name", "Family name", retired.familyName, survivor.familyName);
  text("given_name", "Given name", retired.givenName, survivor.givenName);
  text("middle_name", "Middle name", retired.middleName, survivor.middleName);
  text("suffix", "Suffix", retired.suffix, survivor.suffix);
  if (retired.birthDate !== survivor.birthDate)
    differences.push({ code: "birth_date", field: "Birth date", retired: retired.birthDate, survivor: survivor.birthDate });
  if (retired.sex !== survivor.sex) differences.push({ code: "sex", field: "Sex", retired: retired.sex, survivor: survivor.sex });
  if ((retired.status === "deceased") !== (survivor.status === "deceased")) {
    differences.push({ code: "deceased_status", field: "Deceased", retired: retired.status, survivor: survivor.status });
  }
  const key = (i: MergeIdentifierFacts) => `${i.type}|${i.issuer ?? ""}`;
  const survivorByKey = new Map<string, Set<string>>();
  for (const i of identifiers.survivor) survivorByKey.set(key(i), (survivorByKey.get(key(i)) ?? new Set()).add(i.valueNormalized));
  const seen = new Set<string>();
  for (const i of identifiers.retired) {
    const theirs = survivorByKey.get(key(i));
    if (!theirs || theirs.has(i.valueNormalized) || seen.has(key(i))) continue;
    seen.add(key(i));
    differences.push({
      code: `identifier:${i.type}${i.issuer ? `:${i.issuer}` : ""}`,
      field: `Identifier (${i.type}${i.issuer ? `, ${i.issuer}` : ""})`,
      retired: i.valueNormalized,
      survivor: [...theirs].join(", "),
    });
  }
  return differences;
}

/** Codes of flagged differences not in the caller's acknowledgement. */
export function unacknowledgedDifferences(differences: MergeDifference[], acknowledged: readonly string[]): MergeDifferenceCode[] {
  const ack = new Set(acknowledged);
  return differences.filter((d) => !ack.has(d.code)).map((d) => d.code);
}

/**
 * Work in progress filed under the record that would be retired. A `blocker` would be lost or mis-sent after the merge
 * (reminders are never sent to a merged record, new care cannot be filed under it): finish, cancel or rebook it first.
 * A `warning` is shown but does not block.
 */
export type MergeWorkKind =
  | "encounter_in_progress"
  | "online_consultation_in_progress"
  | "queue_visit"
  | "upcoming_appointment"
  | "lab_order_open"
  | "draft_invoice"
  | "uninvoiced_charge"
  | "account_balance"
  | "care_plan_active"
  | "referral_open";

export interface MergeWorkItem {
  kind: MergeWorkKind;
  id: string;
  /** Short display text: names, numbers, dates. Never notes or clinical content. */
  label: string;
  at: string | null;
  /** The screen that resolves it; the staff app maps the type to a route. */
  link: { type: "encounter" | "visit" | "appointment" | "lab_order" | "invoice" | "billing_patient" | "care_plan" | "referral"; id: string } | null;
}

const WARNING_KINDS: ReadonlySet<MergeWorkKind> = new Set(["care_plan_active", "referral_open"]);

export function splitWorkItems(items: MergeWorkItem[]): { blockers: MergeWorkItem[]; warnings: MergeWorkItem[] } {
  return { blockers: items.filter((i) => !WARNING_KINDS.has(i.kind)), warnings: items.filter((i) => WARNING_KINDS.has(i.kind)) };
}

export type MergeHistoryAction = "merged" | "unmerged" | "repointed";

/** A retired record can be unmerged while it is merged: its latest history entry is a merge or a re-point. */
export function canUnmerge(status: string, latestAction: MergeHistoryAction | undefined): boolean {
  return status === "merged" && (latestAction === "merged" || latestAction === "repointed");
}

/** What happens to MyHealth accounts when merging. */
export type PortalAccountHandling = "none" | "moved_to_survivor" | "retired_disabled" | "survivor_kept";

export function portalAccountHandling(retired: { status: string } | undefined, survivor: { status: string } | undefined): PortalAccountHandling {
  if (!retired) return "none";
  if (!survivor) return "moved_to_survivor";
  return retired.status === "disabled" ? "survivor_kept" : "retired_disabled";
}
