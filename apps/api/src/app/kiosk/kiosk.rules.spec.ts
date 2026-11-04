import {
  DEVICE_FAILURE_BUDGET,
  deviceCoolingDown,
  DEVICE_ONLINE_MS,
  MAX_REPRINTS,
  PRINT_JOB_MAX_AGE_MS,
  PRINT_LEASE_MS,
  PRINT_MAX_ATTEMPTS,
  PRINTER_FRESH_MS,
  printerAvailability,
  deviceHealth,
  hashSessionToken,
  newRegistrationReference,
  newSessionToken,
  SESSION_IDLE_MS,
  SESSION_MAX_MS,
  sessionDeadline,
} from "./kiosk.rules";

describe("kiosk rules", () => {
  const t0 = new Date("2026-11-03T01:00:00Z");

  it("ends a session after the idle time, but never later than the absolute limit", () => {
    expect(sessionDeadline(t0, t0).getTime()).toBe(t0.getTime() + SESSION_IDLE_MS);
    const late = new Date(t0.getTime() + SESSION_MAX_MS - 30_000);
    expect(sessionDeadline(t0, late).getTime()).toBe(t0.getTime() + SESSION_MAX_MS);
  });

  it("issues unguessable tokens and stores only their hash", () => {
    const a = newSessionToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newSessionToken()).not.toBe(a);
    expect(hashSessionToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken(a)).not.toContain(a);
  });

  it("makes readable registration references from unambiguous characters", () => {
    for (let i = 0; i < 200; i++) expect(newRegistrationReference()).toMatch(/^KR-[A-HJ-NP-Z2-9]{6}$/);
  });

  it("makes a kiosk cool down once it has used its guesses", () => {
    expect(deviceCoolingDown(DEVICE_FAILURE_BUDGET - 1)).toBe(false);
    expect(deviceCoolingDown(DEVICE_FAILURE_BUDGET)).toBe(true);
  });

  it("calls a kiosk online only while it keeps reporting, and lets an operator's status win", () => {
    const fresh = new Date(t0.getTime() - DEVICE_ONLINE_MS + 1_000);
    const stale = new Date(t0.getTime() - DEVICE_ONLINE_MS - 1_000);
    expect(deviceHealth({ status: "active", heartbeatAt: fresh }, t0)).toBe("online");
    expect(deviceHealth({ status: "active", heartbeatAt: stale }, t0)).toBe("offline");
    expect(deviceHealth({ status: "active", heartbeatAt: null }, t0)).toBe("offline");
    expect(deviceHealth({ status: "maintenance", heartbeatAt: fresh }, t0)).toBe("maintenance");
    expect(deviceHealth({ status: "disabled", heartbeatAt: fresh }, t0)).toBe("disabled");
  });

  describe("printer availability", () => {
    const fresh = new Date(t0.getTime() - PRINTER_FRESH_MS + 1_000);
    const stale = new Date(t0.getTime() - PRINTER_FRESH_MS - 1_000);

    it("is working only when its last, recent report was fine", () => {
      expect(printerAvailability({ printerStatus: "ok", printerHeartbeatAt: fresh }, t0)).toBe("available");
      expect(printerAvailability({ printerStatus: "paper_out", printerHeartbeatAt: fresh }, t0)).toBe("attention");
      expect(printerAvailability({ printerStatus: "offline", printerHeartbeatAt: fresh }, t0)).toBe("attention");
      expect(printerAvailability({ printerStatus: "error", printerHeartbeatAt: fresh }, t0)).toBe("attention");
    });

    it("is not known to work when the agent has gone quiet, or never reported, or the kiosk has no printer", () => {
      expect(printerAvailability({ printerStatus: "ok", printerHeartbeatAt: stale }, t0)).toBe("unavailable");
      expect(printerAvailability({ printerStatus: "unknown", printerHeartbeatAt: null }, t0)).toBe("unknown");
      expect(printerAvailability({ printerStatus: "none", printerHeartbeatAt: fresh }, t0)).toBe("none");
    });

    it("keeps the printing limits sensible: a lease shorter than the age, a few attempts, a few reprints", () => {
      expect(PRINT_LEASE_MS).toBeLessThan(PRINT_JOB_MAX_AGE_MS);
      expect(PRINT_MAX_ATTEMPTS).toBeGreaterThanOrEqual(2);
      expect(PRINT_MAX_ATTEMPTS * PRINT_LEASE_MS).toBeLessThan(PRINT_JOB_MAX_AGE_MS);
      expect(MAX_REPRINTS).toBeGreaterThanOrEqual(1);
    });
  });
});
