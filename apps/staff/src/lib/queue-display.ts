import type { QueueDisplay } from "./api/types";

/** The permission of the waiting-room display (migration 0112). */
export const QUEUE_DISPLAY_PERMISSION = "clinic.queue.display";

/** A display account (role queue_display) holds nothing else: it lands on the display and never sees the staff app. */
export function isDisplayOnly(permissions: readonly string[]): boolean {
  return permissions.length > 0 && permissions.every((p) => p === QUEUE_DISPLAY_PERMISSION);
}

/** Identifies the call being shown now: a new value means someone was just called (or called again). */
export function currentCallKey(display: Pick<QueueDisplay, "calls"> | null): string | null {
  const call = display?.calls[0];
  return call ? `${call.ticket}|${call.calledTo}|${call.calledAt}` : null;
}

/** Whether to chime: the call shown now changed since the last render, and it is not the first render of the page. */
export function shouldChime(previousKey: string | null | undefined, currentKey: string | null): boolean {
  return previousKey !== undefined && currentKey !== null && currentKey !== previousKey;
}
