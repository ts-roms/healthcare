import { describe, expect, it } from "vitest";
import { communicationApiQuery, communicationHref, readCommunicationFilters, shareText, statusView, suppressionReasonText } from "./communications";

const P = "3f1f7c1e-5b36-4a51-9a51-0d6a4c1f0b11";

describe("communication log filters", () => {
  it("defaults to the last 7 days and ignores unknown values", () => {
    const { filters, adjusted } = readCommunicationFilters({ channel: "fax", status: "lost", template: "Bad Key!", patient: "x" }, "2026-09-30");
    expect(filters).toEqual({ from: "2026-09-24", to: "2026-09-30", channel: "", category: "", status: "", template: "", patient: "", facility: "", page: 1 });
    expect(adjusted).toBe(false);
  });

  it("swaps a reversed period and shortens one longer than 92 days", () => {
    expect(readCommunicationFilters({ from: "2026-09-30", to: "2026-09-01" }, "2026-09-30").filters).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
    const long = readCommunicationFilters({ from: "2026-01-01", to: "2026-09-30" }, "2026-09-30");
    expect(long).toMatchObject({ filters: { from: "2026-07-01", to: "2026-09-30" }, adjusted: true });
  });

  it("builds the API query and page links", () => {
    const { filters } = readCommunicationFilters(
      { from: "2026-09-01", to: "2026-09-30", channel: "sms", status: "not_sent", template: "appointment.reminder", patient: P, facility: P, page: "2" },
      "2026-09-30",
    );
    expect(communicationApiQuery(filters)).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
      channel: "sms",
      category: undefined,
      status: "not_sent",
      templateKey: "appointment.reminder",
      patientId: P,
      facilityId: P,
      page: 2,
      pageSize: 50,
    });
    expect(communicationHref(filters, 1)).toBe(
      `/communications?from=2026-09-01&to=2026-09-30&channel=sms&status=not_sent&template=appointment.reminder&patient=${P}&facility=${P}`,
    );
    expect(communicationHref(filters, 3)).toContain("page=3");
    expect(communicationHref(filters, 3, "/communications/export")).not.toContain("page=");
  });
});

describe("communication wording", () => {
  it("puts statuses and reasons into words", () => {
    expect(statusView("suppressed")).toEqual({ label: "Not sent", tone: "warning" });
    expect(statusView("failed").tone).toBe("danger");
    expect(suppressionReasonText("no_outreach_opt_in")).toMatch(/not agreed/);
    expect(suppressionReasonText("staff_sms_not_supported")).toBe("staff sms not supported");
    expect(shareText(3, 120)).toBe("3 of 120 (2.5%)");
    expect(shareText(0, 0)).toBeNull();
  });
});
