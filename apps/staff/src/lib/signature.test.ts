import { describe, expect, it } from "vitest";
import { hasEnoughInk, inkLength, MAX_POINTS, normalizeStrokes } from "./signature";

describe("normalizeStrokes", () => {
  it("scales pixel points into the 0..1 box and clamps strays", () => {
    const strokes = normalizeStrokes(
      [
        [
          { x: 0, y: 0 },
          { x: 300, y: 100 },
          { x: 700, y: -20 },
        ],
      ],
      600,
      200,
    );
    expect(strokes).toEqual([
      [
        [0, 0],
        [0.5, 0.5],
        [1, 0],
      ],
    ]);
  });

  it("drops jitter but keeps each stroke's ends and leaves out empty strokes", () => {
    const strokes = normalizeStrokes(
      [
        [],
        [
          { x: 100, y: 100 },
          { x: 100.2, y: 100 },
          { x: 100.4, y: 100 },
          { x: 130, y: 100 },
          { x: 130.1, y: 100 },
        ],
      ],
      600,
      200,
    );
    expect(strokes).toHaveLength(1);
    expect(strokes[0]![0]).toEqual([0.1667, 0.5]);
    expect(strokes[0]![strokes[0]!.length - 1]).toEqual([0.2168, 0.5]);
    expect(strokes[0]!.length).toBe(3);
  });

  it("thins a very long drawing to the API limit", () => {
    const long = Array.from({ length: 8000 }, (_, i) => ({ x: (i / 8000) * 600, y: 100 + (i % 2) * 30 }));
    const total = normalizeStrokes([long], 600, 200).reduce((n, s) => n + s.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_POINTS);
    expect(total).toBeGreaterThan(100);
  });

  it("refuses to scale into an empty box", () => {
    expect(normalizeStrokes([[{ x: 1, y: 1 }]], 0, 0)).toEqual([]);
  });
});

describe("ink", () => {
  it("counts pen travel and needs about a quarter of the width", () => {
    const tap: Array<Array<[number, number]>> = [[[0.5, 0.5]]];
    const line: Array<Array<[number, number]>> = [
      [
        [0.1, 0.5],
        [0.6, 0.5],
      ],
    ];
    expect(inkLength(tap)).toBe(0);
    expect(hasEnoughInk(tap)).toBe(false);
    expect(inkLength(line)).toBeCloseTo(0.5);
    expect(hasEnoughInk(line)).toBe(true);
  });
});
