import { ageInYears, todayInPhilippines } from "./dates";

describe("todayInPhilippines", () => {
  it("uses Philippine time (UTC+8), not the server timezone", () => {
    // 2026-01-01 17:30 UTC is already 2026-01-02 01:30 in Manila.
    expect(todayInPhilippines(new Date("2026-01-01T17:30:00Z"))).toBe("2026-01-02");
    expect(todayInPhilippines(new Date("2026-01-01T15:59:00Z"))).toBe("2026-01-01");
  });
});

describe("ageInYears", () => {
  it("counts completed years only", () => {
    expect(ageInYears("1980-06-15", "2026-06-14")).toBe(45);
    expect(ageInYears("1980-06-15", "2026-06-15")).toBe(46);
  });

  it("handles leap-day birthdays", () => {
    expect(ageInYears("2000-02-29", "2026-02-28")).toBe(25);
    expect(ageInYears("2000-02-29", "2026-03-01")).toBe(26);
  });
});
