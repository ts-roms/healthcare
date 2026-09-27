import { patientBookingWindow, patientMayChange } from "./patient-booking";

const now = new Date("2026-09-28T01:00:00Z");
const inMinutes = (m: number) => new Date(now.getTime() + m * 60_000);

describe("patient booking rules", () => {
  it("needs two hours' notice", () => {
    expect(patientBookingWindow(inMinutes(119), now)).toBe("too_soon");
    expect(patientBookingWindow(inMinutes(120), now)).toBeNull();
  });

  it("books at most 60 days ahead", () => {
    expect(patientBookingWindow(inMinutes(60 * 24 * 60), now)).toBeNull();
    expect(patientBookingWindow(inMinutes(60 * 24 * 60 + 1), now)).toBe("too_far_ahead");
  });

  it("lets patients change an appointment until two hours before", () => {
    expect(patientMayChange(inMinutes(120), now)).toBe(true);
    expect(patientMayChange(inMinutes(119), now)).toBe(false);
    expect(patientMayChange(inMinutes(-10), now)).toBe(false);
  });
});
