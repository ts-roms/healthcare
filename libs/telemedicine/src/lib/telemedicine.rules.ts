import type { SessionStatus } from "./telemedicine.schema";

/**
 * Online consultation lifecycle (the database checks the same invariants):
 * scheduled → waiting (patient in the waiting room; visit checked in)
 *   → in_consultation (clinician started the telemedicine encounter)
 *   → ended | escalated (to in-person care).
 */
const TRANSITIONS: Record<SessionStatus, readonly SessionStatus[]> = {
  scheduled: ["waiting"],
  waiting: ["in_consultation"],
  in_consultation: ["ended", "escalated"],
  ended: [],
  escalated: [],
};

export function canMove(from: SessionStatus, to: SessionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Video is available only while the consultation is running. */
export function videoOpen(status: SessionStatus): boolean {
  return status === "in_consultation";
}

/** Opaque room name: no patient or appointment data reaches the video provider. */
export function roomName(randomHex32: string): string {
  if (!/^[0-9a-f]{32}$/.test(randomHex32)) throw new Error("Room names need 32 hex characters");
  return `tm-${randomHex32}`;
}
