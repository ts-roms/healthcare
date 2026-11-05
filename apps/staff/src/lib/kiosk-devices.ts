import type { KioskDevice, KioskPrintJob } from "./api/types";

/** Words for a device's health: with an icon and text on screen, never a colour alone. */
export const DEVICE_HEALTH_LABEL: Record<KioskDevice["health"], string> = {
  online: "Online",
  offline: "Offline",
  maintenance: "In maintenance",
  disabled: "Disabled",
};

export const DEVICE_HEALTH_VARIANT: Record<KioskDevice["health"], "success" | "danger" | "warning" | "neutral"> = {
  online: "success",
  offline: "danger",
  maintenance: "warning",
  disabled: "neutral",
};

export const DEVICE_STATUS_LABEL: Record<KioskDevice["status"], string> = {
  active: "In service",
  maintenance: "Maintenance (serves no one)",
  disabled: "Disabled (refused)",
};

/** Where a kiosk's printer is, in words: "Network printer 192.168.1.50:9100", or the printer on the agent's computer. */
export function printerWhere(device: Pick<KioskDevice, "printerConnection" | "printerHost" | "printerPort" | "paperMm">): string {
  const where =
    device.printerConnection === "network"
      ? `Network printer ${device.printerHost}${device.printerPort ? `:${device.printerPort}` : ""}`
      : "Printer on the agent's computer";
  return `${where} · ${device.paperMm} mm`;
}

/** What staff read for a kiosk's printer: what is known, and what to do about it. */
export const PRINTER_LABEL: Record<KioskDevice["printer"], string> = {
  available: "Printer working",
  attention: "Printer needs attention",
  unavailable: "Printer not reporting",
  unknown: "No printer report yet",
  none: "Ticket printing off",
};

export const PRINTER_VARIANT: Record<KioskDevice["printer"], "success" | "danger" | "warning" | "neutral"> = {
  available: "success",
  attention: "danger",
  unavailable: "warning",
  unknown: "neutral",
  none: "neutral",
};

/** The printer's own report, in plain words (paper, connection). */
export const PRINTER_STATUS_DETAIL: Record<KioskDevice["printerStatus"], string> = {
  ok: "Ready",
  paper_out: "Out of paper",
  offline: "Not reachable",
  error: "Reported an error",
  unknown: "Not reported yet",
  none: "Ticket printing is off for this kiosk",
};

export const PRINT_STATUS_LABEL: Record<KioskPrintJob["status"], string> = {
  queued: "Waiting to print",
  printing: "Printing",
  printed: "Printed",
  failed: "Failed",
  cancelled: "Not printed",
};

export const PRINT_STATUS_VARIANT: Record<KioskPrintJob["status"], "success" | "danger" | "warning" | "neutral" | "info"> = {
  queued: "info",
  printing: "info",
  printed: "success",
  failed: "danger",
  cancelled: "neutral",
};

/** Why a ticket did not print, in words (the API keeps a short code). */
export function printErrorText(code: string | null): string {
  switch (code) {
    case "paper_out":
      return "Out of paper";
    case "offline":
      return "Printer not reachable";
    case "attempts_exhausted":
      return "Tried several times";
    case "expired":
      return "Not printed in time";
    case "error":
      return "Printer error";
    default:
      return code ?? "";
  }
}

/** Kiosks that need someone: out of service, not reporting, or with a printer problem. A count for the page's summary line. */
export function devicesNeedingAttention(devices: readonly KioskDevice[]): number {
  return devices.filter((d) => {
    if (d.status === "disabled") return false;
    if (d.status === "maintenance") return false;
    return d.health === "offline" || (d.kind === "kiosk" && (d.printer === "attention" || d.printer === "unavailable"));
  }).length;
}
