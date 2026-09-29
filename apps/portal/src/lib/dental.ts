import { PERMANENT_ROWS, PRIMARY_ROWS, surfaceName, toothLabel, toothName } from "@healthcare/domain";
import type {
  PortalDentalImage,
  PortalDentalItemStatus,
  PortalDentalPlanStatus,
  PortalDentalRecord,
  PortalDentalTooth,
  PortalToothCondition,
  PortalToothSurface,
} from "./api/types";

/**
 * Plain-language wording for the patient's dental record. It repeats what the dentist charted and planned; it does
 * not judge the patient's oral health — questions go to the dentist.
 */

export const CONDITION_TEXT: Record<PortalToothCondition, string> = {
  caries: "Tooth decay (cavity)",
  restoration: "Filling",
  sealant: "Sealant",
  fracture: "Crack or chip",
  crown: "Crown (cap)",
  root_canal: "Root canal treatment",
  missing: "Missing",
  implant: "Implant",
  pontic: "Bridge tooth (replaces a missing tooth)",
  impacted: "Impacted (has not come through the gum)",
  unerupted: "Not yet grown in",
  watch: "Your dentist is keeping an eye on it",
};

/** How a tooth reads at a glance (with an icon and words, never colour alone). */
export type ToothTone = "healthy" | "treated" | "attention" | "watch" | "missing";

export const TOOTH_TONE_TEXT: Record<ToothTone, string> = {
  healthy: "No problems noted",
  treated: "Treated",
  attention: "Needs treatment",
  watch: "Being watched",
  missing: "Missing",
};

const ATTENTION: PortalToothCondition[] = ["caries", "fracture"];
const WATCH: PortalToothCondition[] = ["watch", "impacted", "unerupted"];

export function toothTone(tooth: Pick<PortalDentalTooth, "conditions">): ToothTone {
  const conditions = tooth.conditions.map((c) => c.condition);
  if (conditions.includes("missing")) return "missing";
  if (conditions.some((c) => ATTENTION.includes(c))) return "attention";
  if (conditions.some((c) => WATCH.includes(c))) return "watch";
  return conditions.length ? "treated" : "healthy";
}

/** "16 · upper right first molar", in the record's notation. */
export function toothText(tooth: string, notation: PortalDentalRecord["notation"]): string {
  return `${toothLabel(tooth, notation)} · ${toothName(tooth)}`;
}

/** "mesial and occlusal sides" — surfaces named for this tooth. */
export function surfacesText(tooth: string, surfaces: readonly PortalToothSurface[]): string | null {
  if (!surfaces.length) return null;
  const names = surfaces.map((s) => surfaceName(tooth, s).toLowerCase());
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
  return `${list} ${names.length > 1 ? "sides" : "side"}`;
}

/** "Filling (mesial and occlusal sides); Crown (cap)" or "No problems noted". */
export function conditionsText(tooth: PortalDentalTooth): string {
  if (!tooth.conditions.length) return TOOTH_TONE_TEXT.healthy;
  return tooth.conditions
    .map((c) => {
      const where = surfacesText(tooth.tooth, c.surfaces);
      return where ? `${CONDITION_TEXT[c.condition]} (${where})` : CONDITION_TEXT[c.condition];
    })
    .join("; ");
}

export const PLAN_STATUS_TEXT: Record<PortalDentalPlanStatus, string> = {
  proposed: "Waiting for your decision",
  accepted: "Agreed — not started",
  in_progress: "In progress",
  completed: "Completed",
  declined: "You declined this plan",
  discontinued: "Stopped",
};

export type ItemTone = "awaiting" | "agreed" | "done" | "declined" | "cancelled";

export function planItemState(status: PortalDentalItemStatus): { tone: ItemTone; text: string } {
  switch (status) {
    case "proposed":
      return { tone: "awaiting", text: "Waiting for your decision" };
    case "accepted":
      return { tone: "agreed", text: "You agreed — not done yet" };
    case "completed":
      return { tone: "done", text: "Done" };
    case "declined":
      return { tone: "declined", text: "You declined" };
    case "cancelled":
      return { tone: "cancelled", text: "No longer planned" };
  }
}

/** The odontogram rows to draw: permanent teeth, plus primary teeth when any were charted. */
export function chartRows(chart: readonly PortalDentalTooth[]): Array<{ label: string; teeth: string[] }> {
  const primary = chart.some((t) => Number(t.tooth[0]) >= 5);
  const rows: Array<{ label: string; teeth: string[] }> = [
    { label: "Upper teeth", teeth: [...PERMANENT_ROWS.upper[0], ...PERMANENT_ROWS.upper[1]] },
    { label: "Lower teeth", teeth: [...PERMANENT_ROWS.lower[0], ...PERMANENT_ROWS.lower[1]] },
  ];
  if (primary) {
    rows.splice(1, 0, { label: "Upper baby teeth", teeth: [...PRIMARY_ROWS.upper[0], ...PRIMARY_ROWS.upper[1]] });
    rows.push({ label: "Lower baby teeth", teeth: [...PRIMARY_ROWS.lower[0], ...PRIMARY_ROWS.lower[1]] });
  }
  return rows;
}

export const IMAGE_KIND_TEXT: Record<PortalDentalImage["kind"], string> = {
  periapical: "X-ray of a tooth (periapical)",
  bitewing: "Bitewing X-ray",
  panoramic: "Panoramic X-ray",
  cephalometric: "Skull side view X-ray (cephalometric)",
  occlusal: "Occlusal X-ray",
  cbct: "3D scan (CBCT)",
  intraoral_photo: "Photo inside the mouth",
  extraoral_photo: "Photo of the face or smile",
  other: "Dental image",
};

/** What a decision will record, in words: which items are accepted and which declined. */
export function decisionSummary(items: ReadonlyArray<{ id: string; procedureName: string }>, accepted: ReadonlySet<string>): string {
  const yes = items.filter((i) => accepted.has(i.id)).map((i) => i.procedureName);
  const no = items.filter((i) => !accepted.has(i.id)).map((i) => i.procedureName);
  if (yes.length === 0) return `You decline ${no.length === 1 ? "this treatment" : `all ${no.length} treatments`}.`;
  if (no.length === 0) return `You accept ${yes.length === 1 ? "this treatment" : `all ${yes.length} treatments`}.`;
  return `You accept ${yes.join(", ")} and decline ${no.join(", ")}.`;
}
