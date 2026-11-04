import { describe, expect, it } from "vitest";
import { PRINT_GIVE_UP_MS, printIsFinal, printView } from "./print-status";

describe("printView", () => {
  it("says nothing when this kiosk prints no tickets", () => {
    expect(printView(false, null, 0)).toBeNull();
    expect(printView(false, "printed", 0)).toBeNull();
  });

  it("waits while the ticket is queued or printing, and says to take it once printed", () => {
    expect(printView(true, null, 0)).toMatchObject({ kind: "waiting" });
    expect(printView(true, "queued", 5_000)).toMatchObject({ kind: "waiting" });
    expect(printView(true, "printing", 5_000)).toMatchObject({ kind: "waiting" });
    expect(printView(true, "printed", 5_000)).toMatchObject({ kind: "done", text: expect.stringContaining("take it") });
  });

  it("sends the person to the desk when the ticket will not print, never leaving them without their number", () => {
    for (const state of ["failed", "cancelled"] as const) {
      expect(printView(true, state, 1_000)).toMatchObject({ kind: "problem", text: expect.stringContaining("remember your number") });
    }
    // The printer never answers: stop waiting.
    expect(printView(true, "queued", PRINT_GIVE_UP_MS)).toMatchObject({ kind: "problem" });
    expect(printView(true, null, PRINT_GIVE_UP_MS + 1)).toMatchObject({ kind: "problem" });
  });

  it("stops asking once the outcome is known", () => {
    expect(printIsFinal("printed")).toBe(true);
    expect(printIsFinal("failed")).toBe(true);
    expect(printIsFinal("cancelled")).toBe(true);
    expect(printIsFinal("queued")).toBe(false);
    expect(printIsFinal("printing")).toBe(false);
    expect(printIsFinal(null)).toBe(false);
  });
});
