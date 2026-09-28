import type { ToothCode, ToothCondition, ToothNotation, ToothSurface } from "./types";

/**
 * Dental display helpers for the frontends. The API stores and validates teeth in FDI notation (libs/dental); these
 * only render a tooth in the facility's notation and describe teeth and surfaces for people.
 */

/** Viewer's perspective (facing the patient): the patient's right is on the left. */
export const PERMANENT_ROWS = {
  upper: [
    ["18", "17", "16", "15", "14", "13", "12", "11"],
    ["21", "22", "23", "24", "25", "26", "27", "28"],
  ],
  lower: [
    ["48", "47", "46", "45", "44", "43", "42", "41"],
    ["31", "32", "33", "34", "35", "36", "37", "38"],
  ],
} as const;

export const PRIMARY_ROWS = {
  upper: [
    ["55", "54", "53", "52", "51"],
    ["61", "62", "63", "64", "65"],
  ],
  lower: [
    ["85", "84", "83", "82", "81"],
    ["71", "72", "73", "74", "75"],
  ],
} as const;

export function isPrimaryTooth(tooth: ToothCode): boolean {
  return Number(tooth[0]) >= 5;
}

function parts(tooth: ToothCode) {
  const quadrant = Number(tooth[0]);
  const position = Number(tooth[1]);
  const q = quadrant > 4 ? quadrant - 4 : quadrant;
  return { quadrant, position, q, primary: quadrant > 4, upper: q === 1 || q === 2, right: q === 1 || q === 4, anterior: position <= 3 };
}

/**
 * The tooth in a notation: FDI "16"; Universal 1–32 for permanent teeth and A–T for primary teeth; Palmer as quadrant
 * plus number or letter ("UR6", "LLD").
 */
export function toothLabel(tooth: ToothCode, notation: ToothNotation = "fdi"): string {
  const { position, q, primary } = parts(tooth);
  if (notation === "fdi") return tooth;
  if (notation === "palmer")
    return `${q === 1 || q === 2 ? "U" : "L"}${q === 1 || q === 4 ? "R" : "L"}${primary ? String.fromCharCode(64 + position) : position}`;
  if (!primary) return String([9 - position, 8 + position, 25 - position, 24 + position][q - 1]);
  return String.fromCharCode(64 + [6 - position, 5 + position, 16 - position, 15 + position][q - 1]!);
}

const TYPES = ["central incisor", "lateral incisor", "canine", "first premolar", "second premolar", "first molar", "second molar", "third molar"];
const PRIMARY_TYPES = ["central incisor", "lateral incisor", "canine", "first molar", "second molar"];

/** e.g. "upper right first molar", "lower left primary canine". */
export function toothName(tooth: ToothCode): string {
  const { position, upper, right, primary } = parts(tooth);
  return `${upper ? "upper" : "lower"} ${right ? "right" : "left"} ${primary ? "primary " : ""}${(primary ? PRIMARY_TYPES : TYPES)[position - 1]}`;
}

/** Surfaces the tooth has (incisal on incisors and canines, occlusal on premolars and molars); the API checks this too. */
export function toothSurfaces(tooth: ToothCode): ToothSurface[] {
  return parts(tooth).anterior ? ["M", "I", "D", "B", "L"] : ["M", "O", "D", "B", "L"];
}

/** The anatomical name of a surface on this tooth (buccal vs labial, lingual vs palatal). */
export function surfaceName(tooth: ToothCode, surface: ToothSurface): string {
  const { upper, anterior } = parts(tooth);
  switch (surface) {
    case "M":
      return "Mesial";
    case "D":
      return "Distal";
    case "O":
      return "Occlusal";
    case "I":
      return "Incisal";
    case "B":
      return anterior ? "Labial" : "Buccal";
    case "L":
      return upper ? "Palatal" : "Lingual";
  }
}

export interface ToothConditionMeta {
  value: ToothCondition;
  label: string;
  /** Short chart code shown under the tooth (with the icon/glyph, never colour alone). */
  code: string;
  /** "surfaces" conditions need surfaces; "optional" may have them; "tooth" applies to the whole tooth. */
  site: "surfaces" | "optional" | "tooth";
  /** Absent or not-in-the-mouth conditions exclude every other finding. */
  exclusive?: boolean;
}

export const TOOTH_CONDITIONS: ToothConditionMeta[] = [
  { value: "caries", label: "Caries", code: "C", site: "surfaces" },
  { value: "restoration", label: "Restoration", code: "F", site: "surfaces" },
  { value: "sealant", label: "Sealant", code: "S", site: "surfaces" },
  { value: "fracture", label: "Fracture", code: "Fx", site: "optional" },
  { value: "crown", label: "Crown", code: "Cr", site: "tooth" },
  { value: "root_canal", label: "Root canal", code: "RC", site: "tooth" },
  { value: "watch", label: "Watch", code: "W", site: "tooth" },
  { value: "missing", label: "Missing", code: "X", site: "tooth", exclusive: true },
  { value: "implant", label: "Implant", code: "Im", site: "tooth" },
  { value: "pontic", label: "Pontic", code: "Pn", site: "tooth", exclusive: true },
  { value: "impacted", label: "Impacted", code: "Ip", site: "tooth", exclusive: true },
  { value: "unerupted", label: "Unerupted", code: "Ue", site: "tooth", exclusive: true },
];

export const TOOTH_CONDITION_META: Record<ToothCondition, ToothConditionMeta> = Object.fromEntries(TOOTH_CONDITIONS.map((c) => [c.value, c])) as Record<
  ToothCondition,
  ToothConditionMeta
>;

const SURFACE_ORDER: ToothSurface[] = ["M", "O", "I", "D", "B", "L"];

/** Canonical surface order (M O I D B L), as the API returns them. */
export function sortSurfaces(surfaces: readonly ToothSurface[]): ToothSurface[] {
  return SURFACE_ORDER.filter((s) => surfaces.includes(s));
}

/** e.g. "C·MO F·D" — the chart code of a tooth's findings. */
export function findingsCode(findings: readonly { condition: ToothCondition; surfaces: readonly ToothSurface[] }[]): string {
  return findings.map((f) => `${TOOTH_CONDITION_META[f.condition].code}${f.surfaces.length ? `·${sortSurfaces(f.surfaces).join("")}` : ""}`).join(" ");
}

/** e.g. "Caries (mesial, occlusal); Restoration (distal)" or "Sound". */
export function findingsText(tooth: ToothCode, findings: readonly { condition: ToothCondition; surfaces: readonly ToothSurface[] }[]): string {
  if (!findings.length) return "Sound";
  return findings
    .map(
      (f) =>
        `${TOOTH_CONDITION_META[f.condition].label}${
          f.surfaces.length
            ? ` (${sortSurfaces(f.surfaces)
                .map((s) => surfaceName(tooth, s).toLowerCase())
                .join(", ")})`
            : ""
        }`,
    )
    .join("; ");
}

// ---- periodontal charting ---------------------------------------------------------------------------------

/** Probing sites in recording order: mesio-, mid-, disto-buccal, then mesio-, mid-, disto-lingual (palatal above). */
export const PERIO_SITES = ["MB", "B", "DB", "ML", "L", "DL"] as const;
export type PerioSite = (typeof PERIO_SITES)[number];

/** e.g. "mesio-buccal", "disto-palatal" on an upper tooth, "mid-labial" on an anterior one. */
export function perioSiteName(tooth: ToothCode, site: PerioSite): string {
  const { upper, anterior } = parts(tooth);
  const side = site.endsWith("B") ? (anterior ? "labial" : "buccal") : upper ? "palatal" : "lingual";
  const position = site.length === 1 ? "mid" : site[0] === "M" ? "mesio" : "disto";
  return `${position}-${side}`;
}

/**
 * Whether furcation is assessed on this tooth (permanent molars, upper first premolars, primary molars). A hint for
 * the form; the API validates it.
 */
export function perioHasFurcation(tooth: ToothCode): boolean {
  const { position, primary, upper } = parts(tooth);
  if (primary) return position >= 4;
  return position >= 6 || (upper && position === 4);
}

/** Conditions that leave no tooth to probe (implants are probed). */
const NOT_PROBED: ReadonlySet<ToothCondition> = new Set(["missing", "pontic", "unerupted", "impacted"]);

/**
 * Teeth to offer for probing, in charting order (upper right to upper left, lower left to lower right): the permanent
 * teeth, minus those the odontogram shows missing, replaced by a pontic, or not erupted.
 */
export function perioTeeth(chart: readonly { tooth: string; findings: readonly { condition: ToothCondition }[] }[]): ToothCode[] {
  const absent = new Set(chart.filter((t) => t.findings.some((f) => NOT_PROBED.has(f.condition))).map((t) => t.tooth));
  const order = [...PERMANENT_ROWS.upper[0], ...PERMANENT_ROWS.upper[1], ...[...PERMANENT_ROWS.lower[1]].reverse(), ...[...PERMANENT_ROWS.lower[0]].reverse()];
  return order.filter((t) => !absent.has(t)) as ToothCode[];
}
