import { describe, expect, it } from "vitest";
import {
  bookingDays,
  bookingMessage,
  dayChip,
  dayPages,
  DEFAULT_RULES,
  lengthText,
  longDate,
  rulesFor,
  type Slot,
  slotsByPartOfDay,
  slotTime,
} from "./booking";

const rules = { minLeadMinutes: 120, maxAdvanceDays: 60 };

describe("bookingDays", () => {
  it("starts today when there is still time to book", () => {
    // 09:00 Manila
    const days = bookingDays(new Date("2026-09-28T01:00:00Z"), rules, "Asia/Manila", 3);
    expect(days).toEqual(["2026-09-28", "2026-09-29", "2026-09-30"]);
  });

  it("starts tomorrow late in the evening (the two-hour notice crosses midnight)", () => {
    // 22:30 Manila
    const days = bookingDays(new Date("2026-09-28T14:30:00Z"), rules, "Asia/Manila", 2);
    expect(days).toEqual(["2026-09-29", "2026-09-30"]);
  });

  it("offers every day up to the clinic's horizon, not only the next two weeks", () => {
    const days = bookingDays(new Date("2026-09-28T01:00:00Z"), rules, "Asia/Manila");
    expect(days[0]).toBe("2026-09-28");
    expect(days.at(-1)).toBe("2026-11-27");
    expect(days).toHaveLength(61);
  });

  it("stops at the booking horizon", () => {
    const days = bookingDays(new Date("2026-09-28T01:00:00Z"), { minLeadMinutes: 120, maxAdvanceDays: 2 }, "Asia/Manila", 14);
    expect(days).toEqual(["2026-09-28", "2026-09-29", "2026-09-30"]);
  });
});

describe("dayPages", () => {
  it("splits the days into weeks for the day picker", () => {
    const days = Array.from({ length: 16 }, (_, i) => `d${i}`);
    expect(dayPages(days).map((p) => p.length)).toEqual([7, 7, 2]);
    expect(dayPages([])).toEqual([]);
  });
});

describe("formatting", () => {
  it("labels days and times", () => {
    expect(dayChip("2026-09-30")).toEqual({ weekday: "Wed", day: "30", month: "Sep" });
    expect(longDate("2026-09-30")).toBe("Wednesday, September 30");
    expect(slotTime("2026-09-30T01:30:00Z", "Asia/Manila")).toBe("9:30 AM");
  });

  it("splits slots into morning and afternoon in facility time", () => {
    const slot = (startsAt: string): Slot => ({ startsAt, endsAt: startsAt, practitionerId: "p", practitionerName: "Dr. Reyes" });
    const groups = slotsByPartOfDay([slot("2026-09-30T01:00:00Z"), slot("2026-09-30T05:30:00Z")], "Asia/Manila");
    expect(groups.map((g) => [g.label, g.slots.length])).toEqual([
      ["Morning", 1],
      ["Afternoon", 1],
    ]);
  });

  it("explains refusals in plain words", () => {
    expect(bookingMessage("slot_unavailable", "x")).toMatch(/just took that time/);
    expect(bookingMessage("unknown", "Try again")).toBe("Try again");
  });
});

describe("per-clinic rules", () => {
  const facility = (id: string, minLeadMinutes: number) => ({
    id,
    name: id,
    cityMunicipality: null,
    timeZone: "Asia/Manila",
    practitioners: [],
    rules: { ...DEFAULT_RULES, minLeadMinutes },
  });
  const options = { visitTypes: [], facilities: [facility("a", 60), facility("b", 1440)] };

  it("uses the chosen clinic's rules, the only clinic's, or the defaults", () => {
    expect(rulesFor(options, "b").minLeadMinutes).toBe(1440);
    expect(rulesFor(options, null)).toEqual(DEFAULT_RULES);
    expect(rulesFor({ ...options, facilities: [facility("a", 60)] }, null).minLeadMinutes).toBe(60);
  });

  it("says a rule's length in words", () => {
    expect(lengthText(120)).toBe("2 hours");
    expect(lengthText(60)).toBe("1 hour");
    expect(lengthText(1440)).toBe("1 day");
    expect(lengthText(2880)).toBe("2 days");
    expect(lengthText(90)).toBe("90 minutes");
  });

  it("explains the waiting-list refusals", () => {
    expect(bookingMessage("open_times_available", "x")).toContain("open times");
    expect(bookingMessage("waitlist_not_available", "x")).toContain("does not take");
  });
});
