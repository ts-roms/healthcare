import { describe, expect, it } from "vitest";
import { DEFAULT_IDLE_MINUTES, idleState, parseIdleMinutes } from "./idle";

describe("idle sign-out", () => {
  it("reads the idle period from the environment, with a default and 0 meaning off", () => {
    expect(parseIdleMinutes(undefined)).toBe(DEFAULT_IDLE_MINUTES);
    expect(parseIdleMinutes("")).toBe(DEFAULT_IDLE_MINUTES);
    expect(parseIdleMinutes("abc")).toBe(DEFAULT_IDLE_MINUTES);
    expect(parseIdleMinutes("-5")).toBe(DEFAULT_IDLE_MINUTES);
    expect(parseIdleMinutes("0")).toBe(0);
    expect(parseIdleMinutes("15.9")).toBe(15);
    expect(parseIdleMinutes("99999")).toBe(1440);
  });

  it("warns in the last minute and expires at the limit", () => {
    const last = 1_000_000;
    expect(idleState(last, last + 5 * 60_000, 20)).toEqual({ state: "active", secondsLeft: 900 });
    expect(idleState(last, last + 19 * 60_000, 20)).toEqual({ state: "warning", secondsLeft: 60 });
    expect(idleState(last, last + 19 * 60_000 + 30_000, 20)).toEqual({ state: "warning", secondsLeft: 30 });
    expect(idleState(last, last + 20 * 60_000, 20)).toEqual({ state: "expired", secondsLeft: 0 });
    expect(idleState(last, last + 25 * 60_000, 20)).toEqual({ state: "expired", secondsLeft: 0 });
  });
});
