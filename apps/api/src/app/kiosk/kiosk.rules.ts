import { createHash, randomBytes } from "node:crypto";

/** A person who stops touching the screen is signed out after this long. */
export const SESSION_IDLE_MS = 2 * 60_000;
/** No session lasts longer than this, however busy (a registration form is the longest task). */
export const SESSION_MAX_MS = 15 * 60_000;
/** Wrong answers at identification before the session is locked and the person is sent to the desk. */
export const MAX_IDENTIFY_ATTEMPTS = 3;
/**
 * Wrong identification answers one kiosk may collect within the window before it stops opening sessions and taking
 * guesses: the per-session limit alone would let someone start a new session after each lock.
 */
export const DEVICE_FAILURE_BUDGET = 9;
export const DEVICE_FAILURE_WINDOW_MS = 10 * 60_000;

/** True while the kiosk has used up its guesses; it must not open a session or accept an identification. */
export const deviceCoolingDown = (failuresInWindow: number) => failuresInWindow >= DEVICE_FAILURE_BUDGET;

/** A kiosk that has not reported in this long counts as offline. */
export const DEVICE_ONLINE_MS = 2 * 60_000;
/** A registration nobody reviews is erased after this long; the person is told to see the desk. */
export const REGISTRATION_TTL_MS = 24 * 3_600_000;

export const newSessionToken = () => randomBytes(32).toString("base64url");
export const hashSessionToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** When a session must end: idle after the last touch, or the absolute limit from the start, whichever is first. */
export function sessionDeadline(startedAt: Date, lastTouch: Date): Date {
  return new Date(Math.min(lastTouch.getTime() + SESSION_IDLE_MS, startedAt.getTime() + SESSION_MAX_MS));
}

const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0, 1
/** "KR-7H2QXD": short enough to read out, 32^6 possibilities, no ambiguous characters. */
export function newRegistrationReference(): string {
  const bytes = randomBytes(6);
  return `KR-${[...bytes].map((b) => REFERENCE_ALPHABET[b % REFERENCE_ALPHABET.length]).join("")}`;
}

export type DeviceHealth = "online" | "offline" | "maintenance" | "disabled";

/** What the monitoring list shows: an operator's status wins over the heartbeat. */
export function deviceHealth(device: { status: "active" | "maintenance" | "disabled"; heartbeatAt: Date | null }, now = new Date()): DeviceHealth {
  if (device.status !== "active") return device.status;
  return device.heartbeatAt && now.getTime() - device.heartbeatAt.getTime() <= DEVICE_ONLINE_MS ? "online" : "offline";
}
