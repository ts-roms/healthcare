import { restDays } from "./medical-certificate.rules";

describe("medical certificate rules", () => {
  it("counts rest days with both ends included", () => {
    expect(restDays("2026-10-05", "2026-10-07")).toBe(3);
    expect(restDays("2026-10-05", "2026-10-05")).toBe(1);
    // Across a month end and a leap day.
    expect(restDays("2028-02-28", "2028-03-01")).toBe(3);
    expect(restDays(null, null)).toBeNull();
    expect(restDays("2026-10-07", "2026-10-05")).toBeNull();
  });
});
