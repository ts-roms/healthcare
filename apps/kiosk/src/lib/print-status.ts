/**
 * What the kiosk tells a person about their printed ticket. The screen asks how the ticket's print job is going every
 * couple of seconds; whatever the printer does, the number on screen is the ticket, so a problem only ever sends the person
 * to the desk — it never blocks the check-in.
 */
export type PrintState = "queued" | "printing" | "printed" | "failed" | "cancelled";

/** How often the screen asks, and when it stops waiting for the printer. */
export const PRINT_POLL_MS = 2_000;
export const PRINT_GIVE_UP_MS = 40_000;

export interface PrintView {
  /** `waiting`: still printing; `done`: take the ticket; `problem`: it will not print. */
  kind: "waiting" | "done" | "problem";
  text: string;
}

/** The message for the ticket's print state after `elapsedMs`; null when this kiosk prints no tickets (no job was queued). */
export function printView(jobQueued: boolean, state: PrintState | null, elapsedMs: number): PrintView | null {
  if (!jobQueued) return null;
  if (state === "printed") return { kind: "done", text: "Your ticket is printed. Please take it from the printer." };
  if (state === "failed" || state === "cancelled" || elapsedMs >= PRINT_GIVE_UP_MS) {
    return { kind: "problem", text: "We could not print your ticket. Please remember your number above, or ask the front desk for a printed one." };
  }
  return { kind: "waiting", text: "Printing your ticket…" };
}

/** Whether the screen can stop asking: the ticket printed, or can no longer print. */
export const printIsFinal = (state: PrintState | null) => state === "printed" || state === "failed" || state === "cancelled";
