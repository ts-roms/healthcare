import type { ChartEffect, Notation, ProcedureSite, Surface, ToothCondition } from "./dental.schema";

/**
 * Dental charting rules (docs/domains/dental.md). Teeth are FDI / ISO 3950 two-digit codes: permanent 11–18, 21–28,
 * 31–38, 41–48; primary 51–55, 61–65, 71–75, 81–85. Surfaces are a fixed canonical set: M, D, O (occlusal, posterior
 * teeth only), I (incisal, anterior teeth only), B (buccal / facial / labial) and L (lingual / palatal).
 */

const TOOTH = /^([1-4][1-8]|[5-8][1-5])$/;
const SURFACE_ORDER: Surface[] = ["M", "O", "I", "D", "B", "L"];

export function isTooth(value: string): boolean {
  return TOOTH.test(value);
}

export interface ToothInfo {
  quadrant: number;
  position: number;
  dentition: "permanent" | "primary";
  arch: "upper" | "lower";
  anterior: boolean;
}

export function toothInfo(tooth: string): ToothInfo {
  if (!isTooth(tooth)) throw new Error(`Not an FDI tooth code: ${tooth}`);
  const quadrant = Number(tooth[0]);
  const position = Number(tooth[1]);
  return {
    quadrant,
    position,
    dentition: quadrant <= 4 ? "permanent" : "primary",
    arch: [1, 2, 5, 6].includes(quadrant) ? "upper" : "lower",
    // Incisors and canines (positions 1–3) have an incisal edge; premolars and molars an occlusal surface.
    anterior: position <= 3,
  };
}

/** Surfaces that exist on a tooth: I on incisors and canines, O on premolars and molars. */
export function surfacesOf(tooth: string): Surface[] {
  return toothInfo(tooth).anterior ? ["M", "I", "D", "B", "L"] : ["M", "O", "D", "B", "L"];
}

/** Canonical order without duplicates (M O I D B L). */
export function normalizeSurfaces(surfaces: readonly Surface[]): Surface[] {
  const set = new Set(surfaces);
  return SURFACE_ORDER.filter((s) => set.has(s));
}

/** Surface conditions need surfaces; tooth conditions must not have them; fracture may have either. */
export const SURFACE_CONDITIONS: ReadonlySet<ToothCondition> = new Set(["caries", "restoration", "sealant"]);
const SURFACES_OPTIONAL: ReadonlySet<ToothCondition> = new Set(["fracture"]);
/** A tooth that is absent or not in the mouth has no other finding. */
export const EXCLUSIVE_CONDITIONS: ReadonlySet<ToothCondition> = new Set(["missing", "pontic", "impacted", "unerupted"]);

export interface Finding {
  condition: ToothCondition;
  surfaces: Surface[];
}

/** Problems with one tooth's charted state (empty when valid). No findings means the tooth is sound. */
export function toothStateIssues(tooth: string, findings: readonly Finding[]): string[] {
  if (!isTooth(tooth)) return [`${tooth} is not an FDI tooth code`];
  const issues: string[] = [];
  const valid = new Set(surfacesOf(tooth));
  const seen = new Set<ToothCondition>();
  for (const f of findings) {
    if (seen.has(f.condition)) issues.push(`${f.condition} is charted twice`);
    seen.add(f.condition);
    const wrong = f.surfaces.filter((s) => !valid.has(s));
    if (wrong.length) issues.push(`tooth ${tooth} has no ${wrong.join(", ")} surface`);
    if (SURFACE_CONDITIONS.has(f.condition) && f.surfaces.length === 0) issues.push(`${f.condition} needs the affected surfaces`);
    if (!SURFACE_CONDITIONS.has(f.condition) && !SURFACES_OPTIONAL.has(f.condition) && f.surfaces.length > 0) {
      issues.push(`${f.condition} applies to the whole tooth, not to surfaces`);
    }
  }
  const exclusive = findings.filter((f) => EXCLUSIVE_CONDITIONS.has(f.condition));
  if (exclusive.length && findings.length > 1) issues.push(`${exclusive[0]!.condition} cannot be charted with other findings`);
  if (seen.has("implant") && (seen.has("root_canal") || seen.has("caries"))) issues.push("an implant cannot have caries or a root canal");
  return issues;
}

/** Problems with where a procedure was recorded (tooth and surfaces against the procedure's site). */
export function procedureSiteIssues(site: ProcedureSite, tooth: string | null | undefined, surfaces: readonly Surface[]): string[] {
  if (site === "mouth") return tooth || surfaces.length ? ["this procedure is recorded for the whole mouth, without a tooth"] : [];
  if (!tooth) return ["choose the tooth"];
  if (!isTooth(tooth)) return [`${tooth} is not an FDI tooth code`];
  if (site === "tooth") return surfaces.length ? ["this procedure applies to the whole tooth, not to surfaces"] : [];
  if (surfaces.length === 0) return ["choose the treated surfaces"];
  const valid = new Set(surfacesOf(tooth));
  const wrong = surfaces.filter((s) => !valid.has(s));
  return wrong.length ? [`tooth ${tooth} has no ${wrong.join(", ")} surface`] : [];
}

/**
 * The tooth's findings after a performed procedure with a chart effect. Restorations and sealants cover the treated
 * surfaces (and remove caries there); a crown covers the tooth (caries, restorations, sealants and fractures are no
 * longer charted separately); a root canal is added; an extraction leaves the tooth missing; an implant or pontic
 * replaces whatever was there.
 */
export function applyChartEffect(current: readonly Finding[], effect: ChartEffect, surfaces: readonly Surface[]): Finding[] {
  const treated = new Set(surfaces);
  const without = (conditions: ToothCondition[]) => current.filter((f) => !conditions.includes(f.condition));
  const merged = (condition: ToothCondition) => normalizeSurfaces([...(current.find((f) => f.condition === condition)?.surfaces ?? []), ...surfaces]);
  switch (effect) {
    case "restoration":
    case "sealant": {
      const kept = current
        .filter((f) => f.condition !== effect && !EXCLUSIVE_CONDITIONS.has(f.condition))
        .map((f) => (f.condition === "caries" ? { ...f, surfaces: f.surfaces.filter((s) => !treated.has(s)) } : f))
        .filter((f) => f.condition !== "caries" || f.surfaces.length > 0);
      return sortFindings([...kept, { condition: effect, surfaces: merged(effect) }]);
    }
    case "crown":
      return sortFindings([
        ...without(["caries", "restoration", "sealant", "fracture", "crown", ...EXCLUSIVE_CONDITIONS]),
        { condition: "crown", surfaces: [] },
      ]);
    case "root_canal":
      return sortFindings([...without(["root_canal", ...EXCLUSIVE_CONDITIONS]), { condition: "root_canal", surfaces: [] }]);
    case "missing":
    case "implant":
    case "pontic":
      return [{ condition: effect, surfaces: [] }];
  }
}

const CONDITION_ORDER: ToothCondition[] = [
  "missing",
  "pontic",
  "implant",
  "impacted",
  "unerupted",
  "crown",
  "root_canal",
  "caries",
  "restoration",
  "sealant",
  "fracture",
  "watch",
];

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => CONDITION_ORDER.indexOf(a.condition) - CONDITION_ORDER.indexOf(b.condition));
}

/** A procedure description for charges and lists: name, tooth and surfaces (e.g. "Composite restoration — 16 MO"). */
export function procedureLabel(name: string, tooth: string | null, surfaces: readonly Surface[]): string {
  if (!tooth) return name;
  return `${name} — ${tooth}${surfaces.length ? ` ${normalizeSurfaces(surfaces).join("")}` : ""}`;
}

/**
 * A tooth in a notation, for documents the API prints (the frontends use `toothLabel` in libs/domain, which this must
 * match): FDI "16"; Universal 1–32 for permanent teeth and A–T for primary teeth; Palmer as quadrant plus number or
 * letter ("UR6", "LLD").
 */
export function toothInNotation(tooth: string, notation: Notation): string {
  if (notation === "fdi" || !TOOTH.test(tooth)) return tooth;
  const quadrant = Number(tooth[0]);
  const position = Number(tooth[1]);
  const primary = quadrant > 4;
  const q = primary ? quadrant - 4 : quadrant;
  if (notation === "palmer") return `${q <= 2 ? "U" : "L"}${q === 1 || q === 4 ? "R" : "L"}${primary ? String.fromCharCode(64 + position) : position}`;
  if (!primary) return String([9 - position, 8 + position, 25 - position, 24 + position][q - 1]);
  return String.fromCharCode(64 + [6 - position, 5 + position, 16 - position, 15 + position][q - 1]!);
}

// ---- treatment plans ----------------------------------------------------------------------------------

export type PlanItemState = "proposed" | "accepted" | "declined" | "completed" | "cancelled";

/**
 * A plan's status from its items once the patient has decided: declined when nothing was accepted, completed when all
 * accepted work is done (and nothing awaits a decision), in progress once some work is done, otherwise accepted.
 */
export function planStatusFromItems(items: readonly PlanItemState[]): "accepted" | "in_progress" | "completed" | "declined" {
  const count = (s: PlanItemState) => items.filter((i) => i === s).length;
  const completed = count("completed");
  if (count("accepted") === 0 && count("proposed") === 0) return completed > 0 ? "completed" : "declined";
  return completed > 0 ? "in_progress" : "accepted";
}
