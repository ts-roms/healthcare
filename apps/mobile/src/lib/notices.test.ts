import { describe, expect, it } from "vitest";
import { noticeTime, unreadCount } from "./notices";

const notice = (readAt: string | null) => ({ id: "n", templateKey: "t", subject: "s", text: "x", createdAt: "2026-03-03T01:30:00Z", readAt });

describe("notices", () => {
  it("counts the unread", () => {
    expect(unreadCount([notice(null), notice("2026-03-03T02:00:00Z"), notice(null)])).toBe(2);
    expect(unreadCount([])).toBe(0);
  });

  it("shows times in the clinic's zone: today, yesterday, then the date", () => {
    // 01:30 UTC is 9:30 AM in Manila.
    const now = new Date("2026-03-03T08:00:00Z");
    expect(noticeTime("2026-03-03T01:30:00Z", "Asia/Manila", now)).toMatch(/^Today, 9:30\s?am$/i);
    expect(noticeTime("2026-03-02T09:05:00Z", "Asia/Manila", now)).toMatch(/^Yesterday, 5:05\s?pm$/i);
    expect(noticeTime("2026-02-20T01:30:00Z", "Asia/Manila", now)).toMatch(/^Feb 20, 9:30\s?am$/i);
  });

  it("uses the clinic's day, not the phone's, and survives a bad zone or date", () => {
    // 17:00 UTC on the 2nd is already the 3rd in Manila.
    const now = new Date("2026-03-03T03:00:00Z");
    expect(noticeTime("2026-03-02T17:00:00Z", "Asia/Manila", now)).toMatch(/^Today/);
    expect(noticeTime("2026-03-02T17:00:00Z", "Not/AZone", now)).toMatch(/^Today/);
    expect(noticeTime("garbage", "Asia/Manila", now)).toBe("");
  });
});
