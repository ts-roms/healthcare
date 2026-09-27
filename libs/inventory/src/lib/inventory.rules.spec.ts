import { addDays, allocateFefo, crossedReorderLevel, expiryStatus, isExpired, stockStatus } from "./inventory.rules";

const today = "2026-09-28";
const lots = [
  { lotId: "late", lotNumber: "L3", expiryDate: "2027-06-30", quantity: 50 },
  { lotId: "none", lotNumber: null, expiryDate: null, quantity: 20 },
  { lotId: "soon", lotNumber: "L2", expiryDate: "2026-10-15", quantity: 10 },
  { lotId: "expired", lotNumber: "L1", expiryDate: "2026-09-27", quantity: 100 },
  { lotId: "empty", lotNumber: "L0", expiryDate: "2026-10-01", quantity: 0 },
];

describe("inventory rules", () => {
  it("allocates first-expiry-first-out, never from expired lots, lots without expiry last", () => {
    expect(allocateFefo(lots, 5, today)).toEqual({ ok: true, allocations: [{ lotId: "soon", quantity: 5 }] });
    expect(allocateFefo(lots, 25, today)).toEqual({
      ok: true,
      allocations: [
        { lotId: "soon", quantity: 10 },
        { lotId: "late", quantity: 15 },
      ],
    });
    expect(allocateFefo(lots, 75, today)).toEqual({
      ok: true,
      allocations: [
        { lotId: "soon", quantity: 10 },
        { lotId: "late", quantity: 50 },
        { lotId: "none", quantity: 15 },
      ],
    });
    // 100 units sit in an expired lot: not usable.
    expect(allocateFefo(lots, 81, today)).toEqual({ ok: false, available: 80 });
  });

  it("classifies expiry and stock", () => {
    expect(isExpired("2026-09-28", today)).toBe(false); // the expiry date is still usable
    expect(isExpired("2026-09-27", today)).toBe(true);
    expect(expiryStatus("2026-10-15", today, 30)).toBe("expiring");
    expect(expiryStatus("2027-01-01", today, 30)).toBe("ok");
    expect(expiryStatus("2026-01-01", today, 30)).toBe("expired");
    expect(expiryStatus(null, today, 30)).toBe("no_expiry");
    expect([stockStatus(0, 10), stockStatus(10, 10), stockStatus(11, 10), stockStatus(3, null)]).toEqual(["out", "low", "ok", "ok"]);
    expect([crossedReorderLevel(12, 10, 10), crossedReorderLevel(10, 8, 10), crossedReorderLevel(12, 11, 10), crossedReorderLevel(5, 1, null)]).toEqual([
      true,
      false,
      false,
      false,
    ]);
    expect(addDays("2026-12-25", 10)).toBe("2027-01-04");
  });
});
