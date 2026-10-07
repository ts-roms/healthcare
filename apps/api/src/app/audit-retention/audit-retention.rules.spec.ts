import { archivable, auditMonthStart, removable } from "./audit-retention.rules";

// 2026-10-07 10:00 in Manila.
const now = new Date("2026-10-07T02:00:00Z");
const at = (iso: string) => new Date(iso);

describe("audit retention rules", () => {
  it("counts months in Asia/Manila", () => {
    expect(auditMonthStart(now, 0).toISOString()).toBe("2026-09-30T16:00:00.000Z");
    expect(auditMonthStart(now, 1).toISOString()).toBe("2026-10-31T16:00:00.000Z");
    expect(auditMonthStart(now, -12).toISOString()).toBe("2025-09-30T16:00:00.000Z");
    expect(auditMonthStart(now, 3).toISOString()).toBe("2026-12-31T16:00:00.000Z");
    // 1 October 00:30 in Manila is still 30 September in UTC: the Manila month counts.
    expect(auditMonthStart(new Date("2026-09-30T16:30:00Z"), 0).toISOString()).toBe("2026-09-30T16:00:00.000Z");
  });

  it("archives only a month that has ended, once", () => {
    const closed = { rangeTo: at("2026-09-30T16:00:00Z"), isDefault: false, archive: null };
    expect(archivable(closed, now)).toBe(true);
    expect(archivable({ ...closed, rangeTo: at("2026-10-31T16:00:00Z") }, now)).toBe(false);
    expect(archivable({ ...closed, archive: { status: "pending", removedAt: null } }, now)).toBe(false);
    expect(archivable({ rangeTo: null, isDefault: true, archive: null }, now)).toBe(false);
  });

  it("removes only a verified archive past the retention period, and nothing without one", () => {
    const verified = { rangeTo: at("2025-09-30T16:00:00Z"), isDefault: false, archive: { status: "verified" as const, removedAt: null } };
    expect(removable(verified, now, undefined)).toBe(false);
    expect(removable(verified, now, 12)).toBe(true);
    expect(removable(verified, now, 13)).toBe(false);
    expect(removable({ ...verified, archive: { status: "running", removedAt: null } }, now, 12)).toBe(false);
    expect(removable({ ...verified, archive: { status: "verified", removedAt: now } }, now, 12)).toBe(false);
    expect(removable({ ...verified, archive: null }, now, 12)).toBe(false);
  });
});
