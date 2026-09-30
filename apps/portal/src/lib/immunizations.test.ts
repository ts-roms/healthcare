import { describe, expect, it } from "vitest";
import { byVaccine, sourceText, whenGiven } from "./immunizations";

describe("immunizations in MyHealth", () => {
  it("shows the date as precisely as it is known", () => {
    expect(whenGiven({ occurrence: "2019", occurrencePrecision: "year" }, "Asia/Manila")).toBe("2019");
    expect(whenGiven({ occurrence: "2019-05", occurrencePrecision: "month" }, "Asia/Manila")).toBe("May 2019");
    // Days in the portal's date style (en-PH), e.g. "May 12, 2019".
    const day = new Intl.DateTimeFormat("en-PH", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    expect(whenGiven({ occurrence: "2019-05-12", occurrencePrecision: "day" }, "Asia/Manila")).toBe(day.format(new Date("2019-05-12T00:00:00Z")));
    // 17:30 UTC on 29 September is 30 September in Manila.
    expect(whenGiven({ occurrence: "2026-09-29T17:30:00.000Z", occurrencePrecision: "time" }, "Asia/Manila")).toBe(
      day.format(new Date("2026-09-30T00:00:00Z")),
    );
  });

  it("says where a record comes from and groups doses by vaccine", () => {
    expect(sourceText("historical")).toBe("Recorded from your vaccination record");
    expect(sourceText("administered_here")).toBe("Given at our clinic");
    const dose = { vaccineProduct: null, dose: null, occurrence: "2019", occurrencePrecision: "year" as const, source: "historical" as const, where: null };
    const groups = byVaccine([
      { ...dose, id: "1", vaccineName: "Tetanus" },
      { ...dose, id: "2", vaccineName: "Hepatitis B" },
      { ...dose, id: "3", vaccineName: "tetanus" },
    ]);
    expect(groups.map((g) => [g.vaccine, g.doses.length])).toEqual([
      ["Hepatitis B", 1],
      ["Tetanus", 2],
    ]);
  });
});
