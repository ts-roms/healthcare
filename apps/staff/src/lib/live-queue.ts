/** Connection state of the live queue socket. */
export type LiveStatus = "connecting" | "live" | "offline";

/** How often queue screens tick (waiting times) and, when not live, re-read the queue. */
export const QUEUE_TICK_MS = 15_000;
/** While live, a safety re-read in case an update was missed (updates are at-least-once, but sockets drop). */
export const LIVE_SAFETY_REFRESH_MS = 120_000;
/** Several queue changes in a burst (e.g. check-in then triage) cause one refresh. */
export const LIVE_REFRESH_DEBOUNCE_MS = 400;
/** After the server refuses the socket or a ticket cannot be had, try again after this long. */
export const RECONNECT_DELAY_MS = 30_000;

/** Whether a queue screen should re-read the queue on this tick: every tick when not live, rarely when live. */
export function shouldPoll(status: LiveStatus, lastRefreshAt: number, now: number): boolean {
  return status !== "live" || now - lastRefreshAt >= LIVE_SAFETY_REFRESH_MS;
}

/** Text for the queue screens' connection indicator (always with an icon; never colour alone). */
export function liveStatusLabel(status: LiveStatus): string {
  switch (status) {
    case "live":
      return "Live";
    case "connecting":
      return "Connecting…";
    case "offline":
      return "Updates every 15 s";
  }
}

// Event names live here, not in the "use client" component module: a server component (the dashboard) reads them, and
// values imported from a client module are client references on the server, not arrays.
/** Socket messages that mean the queue changed. */
export const QUEUE_EVENTS = ["queue.updated"] as const;
/** Socket messages that mean the facility laboratory changed (sent only to users who may read laboratory orders). */
export const LAB_EVENTS = ["lab.updated"] as const;
