import { BadRequestError, type TimelinePosition } from "@healthcare/core";

/**
 * The patient timeline's kinds, the rows (sources) each is made of, and the read permission a caller needs to see
 * it — the same permission that gates the domain's own reads. A kind the caller may not read is left out and
 * reported as withheld (never counted).
 */
export const TIMELINE_KINDS = {
  appointment: { permission: "appointment.read", sources: ["appointment"] },
  encounter: { permission: "encounter.read", sources: ["encounter"] },
  referral: { permission: "encounter.read", sources: ["referral"] },
  vitals: { permission: "clinical.read", sources: ["vitals"] },
  prescription: { permission: "prescription.read", sources: ["prescription"] },
  lab_order: { permission: "lab.order.read", sources: ["lab_order"] },
  lab_result_release: { permission: "lab.result.read", sources: ["lab_result_release"] },
  dental: { permission: "dental.record.read", sources: ["dental_exam", "dental_procedure", "dental_plan"] },
  care_plan: { permission: "care-plan.read", sources: ["care_plan", "care_plan_activity"] },
  invoice: { permission: "billing.charge.read", sources: ["invoice"] },
  payment: { permission: "billing.charge.read", sources: ["payment"] },
  communication: { permission: "notification.read", sources: ["communication"] },
  external_history: { permission: "clinical.read", sources: ["external_history"] },
  document: { permission: "document.read", sources: ["document"] },
  immunization: { permission: "immunization.read", sources: ["immunization"] },
} as const satisfies Record<string, { permission: string; sources: readonly string[] }>;

export type TimelineKind = keyof typeof TIMELINE_KINDS;
export type TimelineSource = (typeof TIMELINE_KINDS)[TimelineKind]["sources"][number];

export const TIMELINE_KIND_KEYS = Object.keys(TIMELINE_KINDS) as TimelineKind[];
const SOURCES = new Set<string>(TIMELINE_KIND_KEYS.flatMap((k) => TIMELINE_KINDS[k].sources));

export const TIMELINE_PAGE_SIZE = 50;
export const TIMELINE_MAX_PAGE_SIZE = 100;

/** Which of the requested kinds (all when none are named) the caller may see, and which are withheld. */
export function visibleKinds(
  permissions: ReadonlySet<string>,
  requested?: readonly TimelineKind[] | null,
): { included: TimelineKind[]; withheld: TimelineKind[] } {
  const wanted = requested?.length ? TIMELINE_KIND_KEYS.filter((k) => requested.includes(k)) : TIMELINE_KIND_KEYS;
  return {
    included: wanted.filter((k) => permissions.has(TIMELINE_KINDS[k].permission)),
    withheld: wanted.filter((k) => !permissions.has(TIMELINE_KINDS[k].permission)),
  };
}

/** Entries are ordered by (at, source, id), newest first; returns < 0 when `a` comes first. */
export function compareTimeline(a: TimelinePosition, b: TimelinePosition): number {
  if (a.at !== b.at) return a.at > b.at ? -1 : 1;
  if (a.source !== b.source) return a.source > b.source ? -1 : 1;
  if (a.id !== b.id) return a.id > b.id ? -1 : 1;
  return 0;
}

/**
 * One page from several sources, each already limited to `limit + 1` rows after the cursor (so the page's rows and
 * the probe row are among them): merged in timeline order and trimmed. `next` is the last row's position when
 * more remain.
 */
export function mergePage<T extends TimelinePosition>(sources: ReadonlyArray<readonly T[]>, limit: number): { items: T[]; next: TimelinePosition | null } {
  const merged = sources.flat().sort(compareTimeline);
  const items = merged.slice(0, limit);
  const last = items[items.length - 1];
  return { items, next: merged.length > limit && last ? { at: last.at, source: last.source, id: last.id } : null };
}

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** An opaque cursor (base64url) for the next page. */
export function encodeCursor(position: TimelinePosition): string {
  return Buffer.from(JSON.stringify([position.at, position.source, position.id])).toString("base64url");
}

/** Decodes a cursor this API issued; anything else is a bad request (it never reaches SQL). */
export function decodeCursor(cursor: string): TimelinePosition {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    parsed = null;
  }
  if (Array.isArray(parsed) && parsed.length === 3) {
    const [at, source, id] = parsed as unknown[];
    if (typeof at === "string" && INSTANT.test(at) && typeof source === "string" && SOURCES.has(source) && typeof id === "string" && UUID.test(id)) {
      return { at, source, id };
    }
  }
  throw new BadRequestError("The cursor is not valid for this timeline", "invalid_cursor");
}

/** Up to `max` names, then "+N more". */
export function summarizeNames(names: readonly string[], max = 3): string {
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} +${names.length - max} more`;
}

/** "appointment.no-show" → "Appointment no show"; "chronic_disease" → "Chronic disease". */
export function humanize(key: string): string {
  const words = key.replace(/[._-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
