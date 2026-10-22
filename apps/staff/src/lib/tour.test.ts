import { beforeEach, describe, expect, it } from "vitest";
import { TOUR_STEPS, hasSeenTour, isTourEnabled, markTourSeen, resetTourSeen, setTourEnabled, shouldAutoStart } from "./tour";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe("guided tour preference", () => {
  beforeEach(() => {
    const events = new EventTarget();
    Object.assign(globalThis, {
      window: Object.assign(events, { localStorage: memoryStorage(), dispatchEvent: events.dispatchEvent.bind(events) }),
    });
  });

  it("is on by default and starts once", () => {
    expect(isTourEnabled()).toBe(true);
    expect(shouldAutoStart()).toBe(true);
    markTourSeen();
    expect(hasSeenTour()).toBe(true);
    expect(shouldAutoStart()).toBe(false);
    resetTourSeen();
    expect(shouldAutoStart()).toBe(true);
  });

  it("never starts by itself when turned off", () => {
    setTourEnabled(false);
    expect(isTourEnabled()).toBe(false);
    expect(shouldAutoStart()).toBe(false);
    setTourEnabled(true);
    expect(shouldAutoStart()).toBe(true);
  });

  it("has unique steps", () => {
    expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(TOUR_STEPS.length);
  });
});
