import {
  kioskNetworkAllowed,
  normalizeKioskNetwork,
  isPrivateHost,
  printerHostProblem,
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
      expect(printerAvailability({ printsTickets: true, printerStatus: "ok", printerHeartbeatAt: fresh }, t0)).toBe("available");
      expect(printerAvailability({ printsTickets: true, printerStatus: "paper_out", printerHeartbeatAt: fresh }, t0)).toBe("attention");
      expect(printerAvailability({ printsTickets: true, printerStatus: "offline", printerHeartbeatAt: fresh }, t0)).toBe("attention");
      expect(printerAvailability({ printsTickets: true, printerStatus: "error", printerHeartbeatAt: fresh }, t0)).toBe("attention");
    });

    it("is not known to work when the agent has gone quiet, or never reported, or the kiosk has no printer", () => {
      expect(printerAvailability({ printsTickets: true, printerStatus: "ok", printerHeartbeatAt: stale }, t0)).toBe("unavailable");
      expect(printerAvailability({ printsTickets: true, printerStatus: "unknown", printerHeartbeatAt: null }, t0)).toBe("unknown");
      expect(printerAvailability({ printsTickets: true, printerStatus: "none", printerHeartbeatAt: fresh }, t0)).toBe("none");
      expect(printerAvailability({ printsTickets: false, printerStatus: "ok", printerHeartbeatAt: fresh }, t0)).toBe("none");
    });

    it("keeps the printing limits sensible: a lease shorter than the age, a few attempts, a few reprints", () => {
      expect(PRINT_LEASE_MS).toBeLessThan(PRINT_JOB_MAX_AGE_MS);
      expect(PRINT_MAX_ATTEMPTS).toBeGreaterThanOrEqual(2);
      expect(PRINT_MAX_ATTEMPTS * PRINT_LEASE_MS).toBeLessThan(PRINT_JOB_MAX_AGE_MS);
      expect(MAX_REPRINTS).toBeGreaterThanOrEqual(1);
    });
  });

  describe("printer addresses", () => {
    it("accepts only addresses and names on the clinic's own network", () => {
      for (const ok of [
        "192.168.1.50",
        "10.0.0.7",
        "172.16.4.2",
        "172.31.255.1",
        "127.0.0.1",
        "169.254.10.1",
        "::1",
        "fd00::1",
        "receipt-printer",
        "printer.local",
        "front.lan",
      ]) {
        expect(isPrivateHost(ok)).toBe(true);
      }
      for (const bad of ["8.8.8.8", "172.32.0.1", "192.169.1.1", "example.com", "printer.example.ph", "2001:db8::1"]) {
        expect(isPrivateHost(bad)).toBe(false);
      }
    });

    it("explains what is wrong with an address in words for the person setting it up", () => {
      expect(printerHostProblem("192.168.1.50")).toBeNull();
      expect(printerHostProblem("8.8.8.8")).toMatchObject({ code: "printer_host_not_private" });
      expect(printerHostProblem("http://192.168.1.50/")).toMatchObject({ code: "printer_host_invalid" });
      expect(printerHostProblem("my printer")).toMatchObject({ code: "printer_host_invalid" });
    });
  });
});

describe("kiosk network allowlist", () => {
  it("accepts addresses and CIDR ranges, IPv4 and IPv6, and nothing else", () => {
    expect(normalizeKioskNetwork(" 203.0.113.7 ")).toBe("203.0.113.7");
    expect(normalizeKioskNetwork("203.0.113.0/24")).toBe("203.0.113.0/24");
    expect(normalizeKioskNetwork("2001:DB8::/48")).toBe("2001:db8::/48");
    for (const bad of ["clinic.example.ph", "203.0.113.0/33", "10.0.0.0/8/1", "", "/24", "::/129"]) expect(normalizeKioskNetwork(bad)).toBeNull();
  });

  it("lets a kiosk with no list be used anywhere, and one with a list only from inside it", () => {
    expect(kioskNetworkAllowed("198.51.100.4", [])).toBe(true);
    expect(kioskNetworkAllowed("203.0.113.9", ["203.0.113.0/24"])).toBe(true);
    expect(kioskNetworkAllowed("::ffff:203.0.113.9", ["203.0.113.0/24"])).toBe(true);
    expect(kioskNetworkAllowed("203.0.114.1", ["203.0.113.0/24"])).toBe(false);
    expect(kioskNetworkAllowed("203.0.113.7", ["203.0.113.7"])).toBe(true);
    expect(kioskNetworkAllowed("2001:db8:0:1::5", ["2001:db8::/48"])).toBe(true);
    expect(kioskNetworkAllowed(undefined, ["203.0.113.0/24"])).toBe(false);
  });
});
