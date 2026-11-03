import { describe, expect, it } from "vitest";
import { GRACE_MS, idleState, WARN_AFTER_MS } from "./idle";

describe("idleState", () => {
  it("is active until the warning time, warns with a countdown, then expires", () => {
    expect(idleState(0, WARN_AFTER_MS - 1).kind).toBe("active");
    expect(idleState(0, WARN_AFTER_MS)).toEqual({ kind: "warning", secondsLeft: GRACE_MS / 1000 });
    expect(idleState(0, WARN_AFTER_MS + GRACE_MS - 1500)).toEqual({ kind: "warning", secondsLeft: 2 });
    expect(idleState(0, WARN_AFTER_MS + GRACE_MS).kind).toBe("expired");
  });

  it("clears the screen before the server's own two idle minutes would end the session", () => {
    expect(WARN_AFTER_MS + GRACE_MS).toBeLessThan(2 * 60_000);
  });
});
