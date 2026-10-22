import { describe, expect, it } from "vitest";
import { addPoint, segmentBox, strokeBoxes } from "./signature-draw";

describe("signature pad geometry", () => {
  it("drops points that are too close to the last one", () => {
    const stroke = [{ x: 10, y: 10 }];
    expect(addPoint(stroke, { x: 11, y: 11 })).toBe(false);
    expect(addPoint(stroke, { x: 20, y: 10 })).toBe(true);
    expect(stroke).toHaveLength(2);
    expect(addPoint([], { x: 1, y: 1 })).toBe(true);
  });

  it("places a rectangle between two points: centred, as long as the gap, rotated to match", () => {
    const horizontal = segmentBox({ x: 0, y: 10 }, { x: 40, y: 10 }, 4);
    expect(horizontal).toMatchObject({ left: 0, top: 8, length: 40, thickness: 4, angle: 0 });
    const diagonal = segmentBox({ x: 0, y: 0 }, { x: 30, y: 30 }, 2);
    expect(diagonal.angle).toBeCloseTo(45);
    expect(diagonal.length).toBeCloseTo(Math.hypot(30, 30));
    const up = segmentBox({ x: 5, y: 20 }, { x: 5, y: 0 }, 2);
    expect(up.angle).toBeCloseTo(-90);
  });

  it("draws a single point as a dot and a stroke as one rectangle per gap", () => {
    expect(strokeBoxes([], 3)).toEqual([]);
    const dot = strokeBoxes([{ x: 10, y: 10 }], 3);
    expect(dot).toHaveLength(1);
    expect(dot[0]).toMatchObject({ length: 3, thickness: 3 });
    expect(
      strokeBoxes(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 20, y: 10 },
        ],
        3,
      ),
    ).toHaveLength(2);
  });
});
