import { describe, expect, it } from "vitest";
import { currentCallKey, isDisplayOnly, shouldChime } from "./queue-display";

describe("waiting-room display", () => {
  it("recognises a display-only account", () => {
    expect(isDisplayOnly(["clinic.queue.display"])).toBe(true);
    expect(isDisplayOnly(["clinic.queue.display", "clinic.queue.read"])).toBe(false);
    // A member who must first replace a temporary password or set up two-step verification holds nothing yet.
    expect(isDisplayOnly([])).toBe(false);
  });

  it("chimes when the call shown changes, never on the first render or when nobody is called", () => {
    const call = (ticket: string, calledTo: string, calledAt: string) => ({ calls: [{ ticket, calledTo, calledAt }] });
    const first = currentCallKey(call("A-001", "Room 1", "2026-10-09T01:00:00Z"));
    expect(shouldChime(undefined, first)).toBe(false);
    expect(shouldChime(first, first)).toBe(false);
    expect(shouldChime(first, currentCallKey(call("A-002", "Room 1", "2026-10-09T01:05:00Z")))).toBe(true);
    // The same ticket called again (to another room, or again later) chimes too.
    expect(shouldChime(first, currentCallKey(call("A-001", "Room 1", "2026-10-09T01:09:00Z")))).toBe(true);
    expect(shouldChime(first, currentCallKey({ calls: [] }))).toBe(false);
    expect(shouldChime(null, first)).toBe(true);
  });
});
