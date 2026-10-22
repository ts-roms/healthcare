import type { PadPoint } from "@healthcare/domain/signature";

/**
 * Geometry for the signature pad. React Native draws no lines without a graphics library, so a stroke is shown as thin
 * rotated rectangles between its points: platform-neutral maths here, the views in `components/signature-pad.tsx`.
 */

/** A point closer than this (in pad pixels) to the last kept point is dropped: a finger jitters, and every point is a view. */
export const MIN_POINT_STEP = 3;

/** Appends a point unless it is too close to the previous one; true when it was kept. */
export function addPoint(stroke: PadPoint[], point: PadPoint, minStep = MIN_POINT_STEP): boolean {
  const last = stroke[stroke.length - 1];
  if (last && Math.hypot(point.x - last.x, point.y - last.y) < minStep) return false;
  stroke.push(point);
  return true;
}

/** Where to put a rectangle of this thickness so that it joins two points: its centre, its length and its rotation. */
export function segmentBox(a: PadPoint, b: PadPoint, thickness: number): { left: number; top: number; length: number; thickness: number; angle: number } {
  const length = Math.max(Math.hypot(b.x - a.x, b.y - a.y), thickness);
  const centreX = (a.x + b.x) / 2;
  const centreY = (a.y + b.y) / 2;
  return { left: centreX - length / 2, top: centreY - thickness / 2, length, thickness, angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI };
}

/** The rectangles that draw a stroke: one per pair of points, or a dot for a single point. */
export function strokeBoxes(stroke: PadPoint[], thickness: number): Array<ReturnType<typeof segmentBox>> {
  if (stroke.length === 0) return [];
  if (stroke.length === 1) return [segmentBox(stroke[0]!, stroke[0]!, thickness)];
  return stroke.slice(1).map((point, i) => segmentBox(stroke[i]!, point, thickness));
}
