import type { AssistantOverviewSurface, AssistantRuleNeed, AssistantSuggestion, AssistantSurface } from "./api/types";

/**
 * The Assistant section's Suggestions pages (docs/domains/assistant.md, "Assistant section"): what the rules turned on at
 * the selected facility say now, grouped into areas as staff think of them. An area is a module tab, offered to a person
 * who holds `assistant.use` and can read at least one of its rules: `permissions` (any one) and `requires` (all) mirror
 * the `requires` of the area's rules in their domain libraries. These only decide which tabs to offer; the API decides
 * again on every request and never names a rule a person may not read.
 */

export const ASSISTANT_HOME = "/assistant/suggestions";

export interface AssistantArea {
  key: string;
  label: string;
  href: string;
  /** The screens whose rules the area shows, in the order shown. */
  surfaces: readonly [AssistantSurface, ...AssistantSurface[]];
  /** Any one of these, with all of `requires`, lets a person read one of the area's rules. */
  permissions: string[];
  requires: string[];
}

const area = (
  key: string,
  label: string,
  surfaces: readonly [AssistantSurface, ...AssistantSurface[]],
  permissions: string[],
  requires: string[] = [],
): AssistantArea => ({
  key,
  label,
  href: `${ASSISTANT_HOME}/${key}`,
  surfaces,
  permissions,
  requires: ["assistant.use", ...requires],
});

export const ASSISTANT_AREAS: readonly AssistantArea[] = [
  area("stock", "Stock", ["inventory"], ["inventory.read"]),
  area("billing", "Billing", ["billing"], ["billing.charge.read"]),
  area("clinic", "Clinic today", ["appointments", "queue"], ["appointment.read", "clinic.queue.read"]),
  area("laboratory", "Laboratory", ["laboratory", "laboratory-quality"], ["lab.result.read", "lab.order.read", "lab.qc.read", "lab.qc.manage"]),
  // The pharmacy's rules read prescriptions waiting at the facility and its stock.
  area("pharmacy", "Pharmacy", ["pharmacy"], ["prescription.dispense"], ["inventory.read"]),
  area("outreach", "Outreach", ["outreach"], ["crm.campaign.manage", "crm.segment.manage", "crm.campaign.approve"]),
  area("security", "Security and compliance", ["security", "settings"], ["audit.read", "compliance.review.manage"]),
];

/** Screens whose rules speak only about the record they show: listed with their state on the overview, never run there. */
export const RECORD_SURFACES: readonly AssistantSurface[] = ["encounter", "dental", "prescribing"];

/** The screen each surface's suggestions also appear on. */
export const SURFACE_SCREENS: Partial<Record<AssistantSurface, { label: string; href: string }>> = {
  inventory: { label: "Inventory", href: "/inventory" },
  billing: { label: "Billing", href: "/billing" },
  appointments: { label: "Appointments", href: "/appointments" },
  queue: { label: "Queue", href: "/queue" },
  laboratory: { label: "Laboratory workbench", href: "/laboratory/worklist" },
  "laboratory-quality": { label: "Quality control", href: "/laboratory/qc" },
  pharmacy: { label: "Pharmacy", href: "/pharmacy" },
  outreach: { label: "Outreach", href: "/outreach" },
  security: { label: "Audit log", href: "/admin/audit" },
  settings: { label: "Settings home", href: "/admin" },
};

/** Where a rule that needs a record on screen speaks. */
export const NEED_PLACE: Record<Exclude<AssistantRuleNeed, "nothing">, string> = {
  encounter: "In a consultation",
  patient: "On a patient's dental record",
  prescription: "On a prescription's dispense screen",
  draft: "When a prescription is written",
};

export function canOpenArea(a: AssistantArea, permissions: readonly string[]): boolean {
  const granted = new Set(permissions);
  return a.requires.every((p) => granted.has(p)) && a.permissions.some((p) => granted.has(p));
}

/** The areas a person may open, in the tab order. */
export function areasFor(permissions: readonly string[]): AssistantArea[] {
  return ASSISTANT_AREAS.filter((a) => canOpenArea(a, permissions));
}

export function assistantArea(key: string): AssistantArea | undefined {
  return ASSISTANT_AREAS.find((a) => a.key === key);
}

/** The surfaces one overview request reads for these areas: theirs, then the record screens' (listed, never run). */
export function overviewSurfaces(areas: readonly AssistantArea[]): AssistantSurface[] {
  return [...new Set([...areas.flatMap((a) => a.surfaces), ...RECORD_SURFACES])];
}

const SEVERITY_ORDER: Record<AssistantSuggestion["severity"], number> = { warning: 0, advice: 1, info: 2 };

export interface AreaSummary {
  /** The first `limit` suggestions across the area's screens, warnings first. */
  items: AssistantSuggestion[];
  /** Suggestions beyond those. */
  more: number;
  dismissed: number;
  withheld: number;
  failed: boolean;
  /** The area's rules this person may read, and how many of them are on here. */
  rulesOn: number;
  rulesReadable: number;
}

/** One area on the overview, from the overview's answer for its screens. */
export function summarizeArea(a: AssistantArea, surfaces: readonly AssistantOverviewSurface[], limit: number): AreaSummary {
  const mine = surfaces.filter((s) => a.surfaces.includes(s.surface));
  const all = mine.flatMap((s) => s.items).sort((x, y) => SEVERITY_ORDER[x.severity] - SEVERITY_ORDER[y.severity]);
  const total = mine.reduce((n, s) => n + s.items.length + s.more, 0);
  const items = all.slice(0, limit);
  const rules = mine.flatMap((s) => s.rules);
  return {
    items,
    more: Math.max(0, total - items.length),
    dismissed: mine.reduce((n, s) => n + s.dismissed, 0),
    withheld: mine.reduce((n, s) => n + s.withheld, 0),
    failed: mine.some((s) => s.failed),
    rulesOn: rules.filter((r) => r.on).length,
    rulesReadable: rules.length,
  };
}

/** "2 of 3 checks on at Main Clinic.", "All 3 checks on at …", "No check is turned on at …". */
export function checksOnText(on: number, readable: number, facilityName: string): string {
  if (readable === 0) return "No check here is available to you.";
  if (on === 0) return `No check is turned on at ${facilityName}.`;
  if (on === readable) return `${readable === 1 ? "The check is" : `All ${readable} checks are`} on at ${facilityName}.`;
  return `${on} of ${readable} checks are on at ${facilityName}.`;
}

/** Rules that speak only about the record a screen shows, which this person may read: one row per rule. */
export function recordRules(surfaces: readonly AssistantOverviewSurface[]): Array<AssistantOverviewSurface["rules"][number] & { place: string }> {
  const seen = new Set<string>();
  const out: Array<AssistantOverviewSurface["rules"][number] & { place: string }> = [];
  for (const s of surfaces) {
    if (!RECORD_SURFACES.includes(s.surface)) continue;
    for (const r of s.rules) {
      if (r.needs === "nothing" || seen.has(r.ruleId)) continue;
      seen.add(r.ruleId);
      out.push({ ...r, place: NEED_PLACE[r.needs] });
    }
  }
  return out;
}
