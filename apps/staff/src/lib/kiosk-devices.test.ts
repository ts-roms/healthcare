import { describe, expect, it } from "vitest";
import type { KioskDevice } from "./api/types";
import { devicesNeedingAttention, printerWhere, printErrorText } from "./kiosk-devices";

const device = (over: Partial<KioskDevice>): KioskDevice => ({
  id: "d1",
  code: "front-1",
  name: "Front kiosk",
  kind: "kiosk",
  facilityId: "f1",
  status: "active",
  health: "online",
  heartbeatAt: "2026-11-04T01:00:00Z",
  appVersion: "0.1.0",
  printsTickets: true,
  printAgentUserId: null,
  printerConnection: "agent_local",
  printerHost: null,
  printerPort: null,
  paperMm: 80,
  printerStatus: "ok",
  printer: "available",
  printerHeartbeatAt: "2026-11-04T01:00:00Z",
  allowedNetworks: [],
  version: 1,
  ...over,
});

describe("devicesNeedingAttention", () => {
  it("counts kiosks and screens that are not reporting, and kiosks whose printer needs someone", () => {
    expect(devicesNeedingAttention([device({}), device({ health: "offline" }), device({ printer: "attention" }), device({ printer: "unavailable" })])).toBe(3);
  });

  it("does not count what staff put out of service on purpose, a kiosk without a printer, or a display", () => {
    expect(
      devicesNeedingAttention([
        device({ status: "maintenance", health: "maintenance" }),
        device({ status: "disabled", health: "disabled" }),
        device({ printer: "none", printerStatus: "none" }),
        device({ kind: "display", printer: "none" }),
      ]),
    ).toBe(0);
    expect(devicesNeedingAttention([device({ kind: "display", health: "offline", printer: "none" })])).toBe(1);
  });
});

describe("printErrorText", () => {
  it("says what went wrong in words", () => {
    expect(printErrorText("paper_out")).toBe("Out of paper");
    expect(printErrorText("expired")).toBe("Not printed in time");
    expect(printErrorText(null)).toBe("");
  });
});

describe("printerWhere", () => {
  it("says where a kiosk's printer is and its roll width", () => {
    expect(printerWhere({ printerConnection: "agent_local", printerHost: null, printerPort: null, paperMm: 80 })).toBe(
      "Printer on the agent's computer · 80 mm",
    );
    expect(printerWhere({ printerConnection: "network", printerHost: "192.168.1.50", printerPort: 9100, paperMm: 58 })).toBe(
      "Network printer 192.168.1.50:9100 · 58 mm",
    );
    expect(printerWhere({ printerConnection: "network", printerHost: "printer-2.local", printerPort: null, paperMm: 80 })).toBe(
      "Network printer printer-2.local · 80 mm",
    );
  });
});
