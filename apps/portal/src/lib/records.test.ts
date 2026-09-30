import { expect, it } from "vitest";
import type { PortalPrescription } from "./api/types";
import { howToTake, visitTime } from "./records";

it("summarizes how to take a medicine", () => {
  const base = {
    doseAmount: 1,
    doseUnit: "tablet",
    frequency: "twice_daily",
    frequencyText: null,
    asNeededReason: null,
    durationValue: 7,
    durationUnit: "days",
  } as const;
  expect(howToTake(base as unknown as PortalPrescription["items"][number])).toBe("1 tablet twice a day for 7 days");
  expect(
    howToTake({
      ...base,
      doseAmount: null,
      frequency: "as_needed",
      asNeededReason: "fever",
      durationValue: null,
    } as unknown as PortalPrescription["items"][number]),
  ).toBe("when needed for fever");
});

it("shows visit times in the clinic's time zone", () => {
  expect(visitTime({ startsAt: "2026-09-30T01:30:00Z", timeZone: "Asia/Manila" })).toBe("Wed, Sep 30, 2026, 9:30 AM");
});
