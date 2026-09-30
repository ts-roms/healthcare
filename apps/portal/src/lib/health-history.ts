import type { PortalHealthHistory } from "./api/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A past date as precisely as it is known: "2019", "May 2019", "May 12, 2019" (en-PH), or "Date not known". */
export function pastDate(value: string | null): string {
  if (!value) return "Date not known";
  if (/^\d{4}$/.test(value)) return value;
  if (/^\d{4}-\d{2}$/.test(value)) return `${MONTHS[Number(value.slice(5, 7)) - 1] ?? ""} ${value.slice(0, 4)}`.trim();
  return new Intl.DateTimeFormat("en-PH", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

/** Where an entry comes from, in plain words. */
export function historySourceText(source: string): string {
  if (source === "recorded_here") return "Recorded by our clinic from your records";
  if (source === "external_import") return "From another provider's records";
  return "As told to our clinic";
}

export const CONDITION_STATUS_TEXT: Record<PortalHealthHistory["conditions"][number]["status"], string> = {
  active: "Still present",
  resolved: "Resolved",
  unknown: "Status not known",
};

/** "Taking since May 2019" / "Stopped 2020" / "Not known whether still taking". */
export function medicationStatusText(m: Pick<PortalHealthHistory["medications"][number], "status" | "started" | "stopped">): string {
  if (m.status === "stopped") return m.stopped ? `Stopped ${pastDate(m.stopped)}` : "Stopped";
  if (m.status === "taking") return m.started ? `Taking since ${pastDate(m.started)}` : "Taking";
  return "Not known whether still taking";
}

/** The family history state in plain words ("no known illness in the family" only after the clinic asked). */
export function familyStateText(family: Pick<PortalHealthHistory["family"], "state" | "unknownReason">): string {
  switch (family.state) {
    case "recorded":
      return "Conditions in the family, as told to the clinic:";
    case "none_known":
      return "No known illness that runs in the family, as told to the clinic.";
    case "unknown":
      return family.unknownReason === "adopted"
        ? "The family history is not known (adopted)."
        : family.unknownReason === "declined_to_answer"
          ? "The family history was not shared."
          : "The family history is not known.";
    default:
      return "The clinic has not recorded the family history yet.";
  }
}
