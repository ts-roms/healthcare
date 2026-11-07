/**
 * The waiting-room display's playback queue. Calls arrive from the live feed (and from the fallback poll), sometimes close
 * together or twice; this keeps what the screen says orderly:
 *
 * - **one at a time** — a call is read out after the one before it, never over it;
 * - **no repeats** — the same call (same ticket, place and call time) is announced once, however many events carry it; a
 *   recall has a new call time, so it is a new call and is announced again;
 * - **no backlog** — only the last few calls wait, and one that has waited too long to still be useful is dropped, so a busy
 *   moment never makes the screen announce numbers minutes late.
 */
export interface Announcement {
  /** Identifies the call: the same call always has the same key. */
  key: string;
  lines: ReadonlyArray<{ lang: string; text: string }>;
}

/** How many calls may wait behind the one being announced; older ones are dropped. */
export const ANNOUNCEMENT_MAX_WAITING = 3;
/** A call waiting longer than this is no longer worth announcing. */
export const ANNOUNCEMENT_STALE_MS = 45_000;
/** A call already announced is not announced again for this long. */
export const ANNOUNCEMENT_REMEMBER_MS = 10 * 60_000;

export class AnnouncementQueue {
  private waiting: Array<Announcement & { queuedAt: number }> = [];
  private announced = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Adds a call; false when it was already announced (or is already waiting), so it is not said twice. */
  enqueue(announcement: Announcement): boolean {
    const at = this.now();
    for (const [key, when] of this.announced) if (at - when > ANNOUNCEMENT_REMEMBER_MS) this.announced.delete(key);
    if (this.announced.has(announcement.key)) return false;
    this.announced.set(announcement.key, at);
    this.waiting.push({ ...announcement, queuedAt: at });
    // Newest calls matter most: when too many wait, the oldest are dropped.
    while (this.waiting.length > ANNOUNCEMENT_MAX_WAITING) this.waiting.shift();
    return true;
  }

  /** The next call to announce, oldest first; calls that waited too long are skipped. Null when nothing is waiting. */
  next(): Announcement | null {
    const cutoff = this.now() - ANNOUNCEMENT_STALE_MS;
    while (this.waiting.length > 0) {
      const item = this.waiting.shift();
      if (item && item.queuedAt >= cutoff) return { key: item.key, lines: item.lines };
    }
    return null;
  }

  /** Forgets what is waiting (the sound was turned off). What was announced stays remembered. */
  clear(): void {
    this.waiting = [];
  }

  get size(): number {
    return this.waiting.length;
  }
}
