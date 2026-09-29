import { describe, expect, it } from "vitest";
import { periodText, waitingText } from "./records-mapping";

describe("records request wording", () => {
  const f = (d: string) => d;
  it("describes the period asked for", () => {
    expect(periodText(null, null, f)).toBe("Any time");
    expect(periodText("2026-01-01", "2026-06-30", f)).toBe("2026-01-01 to 2026-06-30");
    expect(periodText("2026-01-01", null, f)).toBe("From 2026-01-01");
    expect(periodText(null, "2026-06-30", f)).toBe("Up to 2026-06-30");
  });
  it("says how long a request has waited", () => {
    expect(waitingText(0)).toBe("Today");
    expect(waitingText(1)).toBe("1 day");
    expect(waitingText(5)).toBe("5 days");
  });
});
