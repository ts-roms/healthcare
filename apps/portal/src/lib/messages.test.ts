import { describe, expect, it } from "vitest";
import { messageAction, messageSource, messageTime } from "./messages";

describe("messages", () => {
  it("points each kind of message to the right place", () => {
    expect(messageAction({ templateKey: "lab.results-available" })).toEqual({ href: "/results", label: "See your results" });
    expect(messageAction({ templateKey: "care-plan.follow-up-due" })?.href).toBe("/appointments/book");
    expect(messageAction({ templateKey: "appointment.no-show" })?.href).toBe("/appointments/book");
    expect(messageAction({ templateKey: "clinic.message" })).toBeNull();
  });

  it("names the source", () => {
    expect(messageSource({ templateKey: "clinic.message" })).toBe("From your clinic");
    expect(messageSource({ templateKey: "care-plan.follow-up-due" })).toBe("Your care plan");
  });

  it("formats times relative to today in Manila", () => {
    const now = new Date("2026-09-28T04:00:00Z"); // 12:00 Manila
    expect(messageTime("2026-09-28T01:30:00Z", now)).toBe("Today, 9:30 AM");
    expect(messageTime("2026-09-27T08:05:00Z", now)).toBe("Yesterday, 4:05 PM");
    expect(messageTime("2026-09-20T08:05:00Z", now)).toBe("Sep 20, 2026");
  });
});
