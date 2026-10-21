/**
 * Drawn signatures (docs/architecture/electronic-signatures.md): the pad collects pixel points; the API takes strokes as
 * polylines of [x, y] in 0..1 inside a 3:1 box. These helpers only reshape what was drawn; whether it can stand as a
 * signature (some real ink, not oversized) is decided by the API.
 */

export type PadPoint = { x: number; y: number };
export type SignatureStroke = Array<[number, number]>;

/** The API's limits (procedure.dto.ts): at most 64 strokes and 3000 points in all. */
export const MAX_STROKES = 64;
export const MAX_POINTS = 3000;

/** Points closer than this (as a share of the box width) to the previous kept point are dropped. */
const MIN_STEP = 0.002;

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Pixel strokes → strokes in 0..1, small jitters dropped (the last point of each stroke is always kept) and the total
 * thinned evenly if the drawing is still above the limit. Empty strokes are left out.
 */
export function normalizeStrokes(strokes: PadPoint[][], width: number, height: number): SignatureStroke[] {
  if (width <= 0 || height <= 0) return [];
  const scaled = strokes
    .filter((stroke) => stroke.length > 0)
    .slice(0, MAX_STROKES)
    .map((stroke) => stroke.map((p): [number, number] => [round4(clamp01(p.x / width)), round4(clamp01(p.y / height))]));
  const reduced = scaled.map((stroke) => {
    const kept: SignatureStroke = [stroke[0]!];
    for (let i = 1; i < stroke.length; i += 1) {
      const last = kept[kept.length - 1]!;
      const point = stroke[i]!;
      const isLast = i === stroke.length - 1;
      if (isLast || Math.hypot(point[0] - last[0], (point[1] - last[1]) / 3) >= MIN_STEP) kept.push(point);
    }
    return kept;
  });
  const total = reduced.reduce((n, stroke) => n + stroke.length, 0);
  if (total <= MAX_POINTS) return reduced;
  // Keep every nth point of each stroke (and its ends) until the drawing fits.
  const every = Math.ceil(total / MAX_POINTS);
  return reduced.map((stroke) => stroke.filter((_, i) => i % every === 0 || i === stroke.length - 1));
}

/** Pen travel as a share of the box width: the API refuses a mark below 0.25 (a dot or a tap). */
export function inkLength(strokes: SignatureStroke[]): number {
  let ink = 0;
  for (const stroke of strokes) {
    for (let i = 1; i < stroke.length; i += 1) ink += Math.hypot(stroke[i]![0] - stroke[i - 1]![0], (stroke[i]![1] - stroke[i - 1]![1]) / 3);
  }
  return ink;
}

/** Whether there is enough ink to ask the API to sign (mirrors its minimum so the button enables at the same point). */
export function hasEnoughInk(strokes: SignatureStroke[]): boolean {
  return inkLength(strokes) >= 0.25;
}
