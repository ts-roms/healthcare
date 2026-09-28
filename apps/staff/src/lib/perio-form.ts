import { PERIO_SITES, type PerioSite } from "@healthcare/domain";

/** One tooth's row in the periodontal charting form (text inputs as typed). */
export interface PerioRow {
  tooth: string;
  depth: Record<PerioSite, string>;
  margin: Record<PerioSite, string>;
  bleeding: Record<PerioSite, boolean>;
  plaque: Record<PerioSite, boolean>;
  suppuration: Record<PerioSite, boolean>;
  mobility: string;
  furcation: string;
}

const each = <T>(value: T) => Object.fromEntries(PERIO_SITES.map((s) => [s, value])) as Record<PerioSite, T>;

export function emptyPerioRow(tooth: string): PerioRow {
  return { tooth, depth: each(""), margin: each(""), bleeding: each(false), plaque: each(false), suppuration: each(false), mobility: "", furcation: "" };
}

export interface PerioPayloadTooth {
  tooth: string;
  mobility?: number;
  furcation?: number;
  sites: Array<{ site: PerioSite; probingDepth?: number; gingivalMargin?: number; bleeding: boolean; suppuration: boolean; plaque: boolean }>;
}

/**
 * The request body's teeth from the form: untouched teeth are left out (not examined), empty measurements are not
 * sent, and anything that is not a whole number in range is reported per tooth (the API checks again).
 */
export function perioPayload(rows: readonly PerioRow[]): { teeth: PerioPayloadTooth[]; errors: Record<string, string> } {
  const teeth: PerioPayloadTooth[] = [];
  const errors: Record<string, string> = {};
  const whole = (value: string, min: number, max: number): number | undefined | null => {
    const v = value.trim();
    if (!v) return undefined;
    if (!/^-?\d{1,2}$/.test(v)) return null;
    const n = Number(v);
    return n >= min && n <= max ? n : null;
  };
  for (const row of rows) {
    const sites: PerioPayloadTooth["sites"] = [];
    let bad: string | null = null;
    for (const site of PERIO_SITES) {
      const probingDepth = whole(row.depth[site], 0, 20);
      const gingivalMargin = whole(row.margin[site], -10, 20);
      if (probingDepth === null) bad ??= `${site}: probing depth is 0–20 mm`;
      if (gingivalMargin === null) bad ??= `${site}: gingival margin is −10 to 20 mm`;
      const touched = probingDepth != null || gingivalMargin != null || row.bleeding[site] || row.plaque[site] || row.suppuration[site];
      if (touched) {
        sites.push({
          site,
          ...(probingDepth != null ? { probingDepth } : {}),
          ...(gingivalMargin != null ? { gingivalMargin } : {}),
          bleeding: row.bleeding[site],
          suppuration: row.suppuration[site],
          plaque: row.plaque[site],
        });
      }
    }
    const mobility = whole(row.mobility, 0, 3);
    const furcation = whole(row.furcation, 0, 3);
    if (mobility === null) bad ??= "mobility is 0–3";
    if (furcation === null) bad ??= "furcation is 0–3";
    if (bad) errors[row.tooth] = bad;
    if (sites.length || mobility != null || furcation != null) {
      teeth.push({ tooth: row.tooth, ...(mobility != null ? { mobility } : {}), ...(furcation != null ? { furcation } : {}), sites });
    }
  }
  return { teeth, errors };
}

/** A probing depth worth drawing attention to (4 mm or more), for the view; not a classification. */
export function deepPocket(depth: number | null): boolean {
  return depth !== null && depth >= 4;
}
