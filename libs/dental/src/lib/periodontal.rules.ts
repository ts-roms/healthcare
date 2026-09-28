import { isTooth, toothInfo } from "./dental.rules";
import { PERIO_SITES, type PerioSite } from "./dental.schema";

/**
 * Periodontal charting rules (docs/domains/dental.md#periodontal-charting). Measurements and derived figures only:
 * nothing here stages, grades or diagnoses periodontal disease — that is the dentist's judgement.
 */

export interface PerioSiteInput {
  site: PerioSite;
  /** mm, 0–20. */
  probingDepth?: number | null;
  /** mm relative to the CEJ, −10 to 20: positive = recession, negative = margin coronal to the CEJ. */
  gingivalMargin?: number | null;
  bleeding?: boolean;
  suppuration?: boolean;
  plaque?: boolean;
}

export interface PerioToothInput {
  tooth: string;
  /** Miller 0–3. */
  mobility?: number | null;
  /** 0 none, 1–3 Glickman classes I–III; multi-rooted teeth only. */
  furcation?: number | null;
  sites: PerioSiteInput[];
}

/**
 * Teeth with a furcation to assess: permanent molars and upper first premolars (usually two-rooted), and primary
 * molars. Single-rooted teeth have none.
 */
export function hasFurcation(tooth: string): boolean {
  const { dentition, position, arch } = toothInfo(tooth);
  if (dentition === "primary") return position >= 4;
  return position >= 6 || (arch === "upper" && position === 4);
}

/** Problems with one charted tooth (empty when valid). */
export function perioToothIssues(t: PerioToothInput): string[] {
  if (!isTooth(t.tooth)) return [`${t.tooth} is not an FDI tooth code`];
  const issues: string[] = [];
  if (t.mobility != null && !(Number.isInteger(t.mobility) && t.mobility >= 0 && t.mobility <= 3)) issues.push("mobility is graded 0–3");
  if (t.furcation != null) {
    if (!(Number.isInteger(t.furcation) && t.furcation >= 0 && t.furcation <= 3)) issues.push("furcation is graded 0–3");
    else if (t.furcation > 0 && !hasFurcation(t.tooth)) issues.push(`tooth ${t.tooth} has no furcation`);
  }
  const seen = new Set<PerioSite>();
  for (const s of t.sites) {
    if (!PERIO_SITES.includes(s.site)) {
      issues.push(`${s.site} is not a probing site`);
      continue;
    }
    if (seen.has(s.site)) issues.push(`site ${s.site} is recorded twice`);
    seen.add(s.site);
    if (s.probingDepth != null && !(Number.isInteger(s.probingDepth) && s.probingDepth >= 0 && s.probingDepth <= 20)) {
      issues.push(`${s.site}: probing depth is 0–20 mm`);
    }
    if (s.gingivalMargin != null && !(Number.isInteger(s.gingivalMargin) && s.gingivalMargin >= -10 && s.gingivalMargin <= 20)) {
      issues.push(`${s.site}: gingival margin is −10 to 20 mm`);
    }
  }
  if (t.sites.length === 0 && t.mobility == null && t.furcation == null) issues.push("record at least one site, the mobility or the furcation");
  return issues;
}

/** Clinical attachment level (mm): probing depth + gingival margin; null unless both were measured. */
export function attachmentLevel(site: Pick<PerioSiteInput, "probingDepth" | "gingivalMargin">): number | null {
  return site.probingDepth == null || site.gingivalMargin == null ? null : site.probingDepth + site.gingivalMargin;
}

export interface PerioSummary {
  teeth: number;
  /** Sites with a probing depth. */
  sitesProbed: number;
  /** Share of probed sites that bled on probing, 0–100 (null when nothing was probed). */
  bleedingPercent: number | null;
  /** Share of recorded sites with plaque, 0–100. */
  plaquePercent: number | null;
  sitesDepth4Plus: number;
  sitesDepth6Plus: number;
  maxProbingDepth: number | null;
  /** Mean clinical attachment level over sites where it can be derived, one decimal. */
  meanAttachmentLevel: number | null;
  suppurationSites: number;
  mobileTeeth: number;
  furcationTeeth: number;
}

const percent = (part: number, whole: number) => (whole === 0 ? null : Math.round((part / whole) * 1000) / 10);

/** Figures over a chart's measurements (a display aid for comparing charts, not a classification). */
export function perioSummary(teeth: readonly PerioToothInput[]): PerioSummary {
  const sites = teeth.flatMap((t) => t.sites);
  const probed = sites.filter((s) => s.probingDepth != null);
  const cal = sites.map(attachmentLevel).filter((v): v is number => v !== null);
  return {
    teeth: teeth.length,
    sitesProbed: probed.length,
    bleedingPercent: percent(probed.filter((s) => s.bleeding).length, probed.length),
    plaquePercent: percent(sites.filter((s) => s.plaque).length, sites.length),
    sitesDepth4Plus: probed.filter((s) => s.probingDepth! >= 4).length,
    sitesDepth6Plus: probed.filter((s) => s.probingDepth! >= 6).length,
    maxProbingDepth: probed.length ? Math.max(...probed.map((s) => s.probingDepth!)) : null,
    meanAttachmentLevel: cal.length ? Math.round((cal.reduce((a, b) => a + b, 0) / cal.length) * 10) / 10 : null,
    suppurationSites: sites.filter((s) => s.suppuration).length,
    mobileTeeth: teeth.filter((t) => (t.mobility ?? 0) > 0).length,
    furcationTeeth: teeth.filter((t) => (t.furcation ?? 0) > 0).length,
  };
}

export interface PerioChange {
  tooth: string;
  site: PerioSite;
  before: number;
  after: number;
}

/**
 * Sites probed in both charts whose probing depth changed by at least `threshold` mm (default 2), deeper ones first:
 * a pointer to where to look, not an assessment.
 */
export function perioChanges(
  previous: readonly PerioToothInput[],
  current: readonly PerioToothInput[],
  threshold = 2,
): { deeper: PerioChange[]; shallower: PerioChange[] } {
  const before = new Map<string, number>();
  for (const t of previous) for (const s of t.sites) if (s.probingDepth != null) before.set(`${t.tooth}:${s.site}`, s.probingDepth);
  const deeper: PerioChange[] = [];
  const shallower: PerioChange[] = [];
  for (const t of current) {
    for (const s of t.sites) {
      const was = before.get(`${t.tooth}:${s.site}`);
      if (was === undefined || s.probingDepth == null) continue;
      const change = { tooth: t.tooth, site: s.site, before: was, after: s.probingDepth };
      if (s.probingDepth - was >= threshold) deeper.push(change);
      else if (was - s.probingDepth >= threshold) shallower.push(change);
    }
  }
  const order = (a: PerioChange, b: PerioChange) => a.tooth.localeCompare(b.tooth) || PERIO_SITES.indexOf(a.site) - PERIO_SITES.indexOf(b.site);
  return { deeper: deeper.sort(order), shallower: shallower.sort(order) };
}
