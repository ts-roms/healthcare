import { describe, expect, it } from "vitest";
import { ANNOUNCEMENT_MAX_WAITING, ANNOUNCEMENT_REMEMBER_MS, ANNOUNCEMENT_STALE_MS, AnnouncementQueue } from "./announcement-queue";

const call = (key: string) => ({ key, lines: [{ lang: "en-PH", text: `Number ${key}` }] });

describe("AnnouncementQueue", () => {
  it("hands calls out one at a time, oldest first", () => {
    const queue = new AnnouncementQueue(() => 0);
    queue.enqueue(call("a"));
    queue.enqueue(call("b"));
    expect(queue.next()?.key).toBe("a");
    expect(queue.next()?.key).toBe("b");
    expect(queue.next()).toBeNull();
  });

  it("announces the same call once, however many events carry it, and a recall (a new call time) again", () => {
    const queue = new AnnouncementQueue(() => 0);
    expect(queue.enqueue(call("A-007|Room 2|10:00"))).toBe(true);
    expect(queue.enqueue(call("A-007|Room 2|10:00"))).toBe(false);
    expect(queue.next()?.key).toBe("A-007|Room 2|10:00");
    // Already said: still not said again.
    expect(queue.enqueue(call("A-007|Room 2|10:00"))).toBe(false);
    // The desk recalled: a new call time, a new announcement.
    expect(queue.enqueue(call("A-007|Room 2|10:03"))).toBe(true);
    expect(queue.size).toBe(1);
  });

  it("forgets what it announced after a while", () => {
    let now = 0;
    const queue = new AnnouncementQueue(() => now);
    queue.enqueue(call("a"));
    queue.next();
    now = ANNOUNCEMENT_REMEMBER_MS + 1;
    expect(queue.enqueue(call("a"))).toBe(true);
  });

  it("keeps only the newest few waiting", () => {
    const queue = new AnnouncementQueue(() => 0);
    for (const key of ["a", "b", "c", "d", "e"]) queue.enqueue(call(key));
    expect(queue.size).toBe(ANNOUNCEMENT_MAX_WAITING);
    expect([queue.next()?.key, queue.next()?.key, queue.next()?.key]).toEqual(["c", "d", "e"]);
  });

  it("drops a call that waited too long to still be useful", () => {
    let now = 0;
    const queue = new AnnouncementQueue(() => now);
    queue.enqueue(call("old"));
    now = ANNOUNCEMENT_STALE_MS + 1;
    queue.enqueue(call("fresh"));
    expect(queue.next()?.key).toBe("fresh");
    expect(queue.next()).toBeNull();
  });

  it("clears what waits when the sound is turned off, but still remembers what was said", () => {
    const queue = new AnnouncementQueue(() => 0);
    queue.enqueue(call("a"));
    queue.next();
    queue.enqueue(call("b"));
    queue.clear();
    expect(queue.size).toBe(0);
    expect(queue.enqueue(call("a"))).toBe(false);
  });
});
