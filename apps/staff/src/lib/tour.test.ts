import { beforeEach, describe, expect, it } from "vitest";
import {
  WELCOME_TOUR_ID,
  hasSeenTour,
  isTourEnabled,
  markTourSeen,
  parseSeen,
  resetTourSeen,
  setTourEnabled,
  tourForPath,
  tourToAutoStart,
  type TourDef,
} from "./tour";
import { TOURS, toursForPermissions } from "./tour-steps";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

const welcome = TOURS.find((t) => t.id === WELCOME_TOUR_ID) as TourDef;

describe("guided tour preference", () => {
  beforeEach(() => {
    const events = new EventTarget();
    Object.assign(globalThis, {
      window: Object.assign(events, { localStorage: memoryStorage(), dispatchEvent: events.dispatchEvent.bind(events) }),
    });
  });

  it("is on by default and each tour starts once", () => {
    expect(isTourEnabled()).toBe(true);
    expect(tourToAutoStart(TOURS, "/queue")?.id).toBe(WELCOME_TOUR_ID);
    markTourSeen(welcome);
    expect(hasSeenTour(welcome)).toBe(true);
    const queue = tourToAutoStart(TOURS, "/queue");
    expect(queue?.id).toBe("queue");
    markTourSeen(queue as TourDef);
    expect(tourToAutoStart(TOURS, "/queue")).toBeUndefined();
    resetTourSeen();
    expect(tourToAutoStart(TOURS, "/queue")?.id).toBe(WELCOME_TOUR_ID);
  });

  it("never starts by itself when turned off", () => {
    setTourEnabled(false);
    expect(tourToAutoStart(TOURS, "/queue")).toBeUndefined();
    setTourEnabled(true);
    expect(tourToAutoStart(TOURS, "/queue")).toBeDefined();
  });

  it("shows a tour again when its version is raised", () => {
    markTourSeen({ id: "queue", version: 1 });
    expect(hasSeenTour({ id: "queue", version: 1 })).toBe(true);
    expect(hasSeenTour({ id: "queue", version: 2 })).toBe(false);
  });

  it("reads the earlier single-number value as the app tour seen", () => {
    expect(parseSeen("1")).toEqual({ [WELCOME_TOUR_ID]: 1 });
    expect(parseSeen("0")).toEqual({});
    expect(parseSeen("not json")).toEqual({});
  });
});

describe("tour content", () => {
  it("has unique ids and non-empty steps", () => {
    expect(new Set(TOURS.map((t) => t.id)).size).toBe(TOURS.length);
    for (const tour of TOURS) {
      expect(tour.steps.length).toBeGreaterThan(0);
      for (const step of tour.steps) {
        expect(step.title).not.toBe("");
        expect(step.body).not.toBe("");
      }
    }
  });

  it("finds the tour of a screen", () => {
    const id = (path: string) => tourForPath(TOURS, path)?.id;
    expect(id("/queue")).toBe("queue");
    expect(id("/queue/walk-in")).toBe("walk-in");
    expect(id("/queue/visits/abc/triage")).toBe("triage");
    expect(id("/patients")).toBe("patients-search");
    expect(id("/patients/new")).toBe("patients-new");
    expect(id("/patients/123")).toBe("patient-record");
    expect(id("/patients/scan")).toBeUndefined();
    expect(id("/clinic/encounters")).toBe("encounters");
    expect(id("/clinic/encounters/abc")).toBe("encounter-workspace");
    expect(id("/billing")).toBe("billing-desk");
    expect(id("/billing/patients/abc")).toBe("billing-patient");
    expect(id("/billing/invoices/abc")).toBe("billing-invoice");
    expect(id("/laboratory/worklist")).toBe("laboratory-worklist");
    expect(id("/account")).toBeUndefined();
  });

  it("lists a screen's tour only to people who can open it", () => {
    const ids = (permissions: string[]) => toursForPermissions(permissions).map((t) => t.id);
    expect(ids([])).toEqual([WELCOME_TOUR_ID, "care-journey"]);
    expect(ids(["billing.charge.read"])).toContain("billing-invoice");
    expect(ids(["billing.charge.read"])).not.toContain("queue");
  });
});
