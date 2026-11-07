import { describe, expect, it } from "vitest";
import {
  announcements,
  callAnnouncement,
  callKeyOf,
  callsSince,
  currentCallKey,
  displayStatusLabel,
  isDisplayOnly,
  parseSoundSettings,
  shouldChime,
  spellTicket,
} from "./queue-display";

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

describe("calls made while the screen was not looking", () => {
  const at = (ticket: string, minute: number) => ({ ticket, calledTo: "Room 1", calledAt: `2026-10-09T01:0${minute}:00Z` });

  it("announces each call since the one shown, oldest first, so a quick second call is not skipped", () => {
    const first = at("A-001", 1);
    const calls = [at("A-003", 3), at("A-002", 2), first];
    expect(callsSince(callKeyOf(first), calls).map((c) => c.ticket)).toEqual(["A-002", "A-003"]);
    expect(callsSince(callKeyOf(calls[1]!), calls).map((c) => c.ticket)).toEqual(["A-003"]);
  });

  it("announces only the newest call when the one shown before is no longer listed, or nothing was shown", () => {
    const calls = [at("A-009", 9), at("A-008", 8)];
    expect(callsSince(callKeyOf(at("A-001", 1)), calls).map((c) => c.ticket)).toEqual(["A-009"]);
    expect(callsSince(null, calls, Date.UTC(2026, 9, 9, 3)).map((c) => c.ticket)).toEqual(["A-009"]);
    expect(callsSince(callKeyOf(calls[0]!), calls).map((c) => c.ticket)).toEqual(["A-009"]);
    expect(callsSince("x", [])).toEqual([]);
  });

  it("announces every call made in the last half minute when the screen showed none before, oldest first", () => {
    const calls = [at("A-003", 3), at("A-002", 2), at("A-001", 1)];
    const now = new Date(calls[0]!.calledAt).getTime() + 5_000;
    // at() spaces the calls an hour apart or so: pin them close together here.
    const close = calls.map((c, i) => ({ ...c, calledAt: new Date(now - 5_000 - i * 1_000).toISOString() }));
    expect(callsSince(null, close, now).map((c) => c.ticket)).toEqual(["A-001", "A-002", "A-003"]);
    // Old calls are not read out again by a screen that reloads.
    expect(callsSince(null, close, now + 10 * 60_000).map((c) => c.ticket)).toEqual(["A-003"]);
  });
});

describe("waiting-room display sound", () => {
  it("reads settings back with defaults for anything missing or unknown", () => {
    expect(parseSoundSettings(null)).toEqual({ level: "normal", voice: "off" });
    expect(parseSoundSettings("not json")).toEqual({ level: "normal", voice: "off" });
    expect(parseSoundSettings(JSON.stringify({ level: "loud", voice: "both" }))).toEqual({ level: "loud", voice: "both" });
    expect(parseSoundSettings(JSON.stringify({ level: "deafening", voice: "en" }))).toEqual({ level: "normal", voice: "en" });
  });

  it("spells a ticket out so that it is heard right", () => {
    expect(spellTicket("A-007")).toBe("A 0 0 7");
    expect(spellTicket("b12")).toBe("B 1 2");
  });

  it("says a call in the chosen language(s), the place as typed", () => {
    const call = { ticket: "A-007", calledTo: "Room 2" };
    expect(announcements(call, "off")).toEqual([]);
    expect(announcements(call, "en")).toEqual([{ lang: "en-PH", text: "Number A 0 0 7, please proceed to Room 2." }]);
    expect(announcements(call, "fil")).toEqual([{ lang: "fil-PH", text: "Numero A 0 0 7, pumunta po sa Room 2." }]);
    expect(announcements(call, "both").map((a) => a.lang)).toEqual(["en-PH", "fil-PH"]);
  });
});

describe("waiting-room display wording", () => {
  it("says the connection in words, never only a colour", () => {
    expect(displayStatusLabel("live")).toBe("Live");
    expect(displayStatusLabel("connecting")).toBe("Reconnecting�");
    expect(displayStatusLabel("offline")).toBe("Offline");
  });

  it("announces a new call to screen readers", () => {
    expect(callAnnouncement({ ticket: "A-024", calledTo: "Counter 3" })).toBe("Ticket A-024, please proceed to Counter 3");
  });
});
