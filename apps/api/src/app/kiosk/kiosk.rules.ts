import { createHash, randomBytes } from "node:crypto";
import { BlockList, isIP } from "node:net";

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

/** An agent holds a claimed print job this long; after it the job can be claimed again (the agent crashed or lost the printer). */
export const PRINT_LEASE_MS = 30_000;
/** A job is tried this many times, then fails. */
export const PRINT_MAX_ATTEMPTS = 3;
/** A ticket not printed within this long is no use any more: the person has moved on and the job is dropped. */
export const PRINT_JOB_MAX_AGE_MS = 10 * 60_000;
/** A ticket can be printed again this many times by staff. */
export const MAX_REPRINTS = 2;
/** A printer that has not reported in this long is not known to be working. */
export const PRINTER_FRESH_MS = 2 * 60_000;

export type PrinterAvailability = "available" | "attention" | "unavailable" | "unknown" | "none";

/**
 * What staff see for a kiosk's printer: `none` when ticket printing is off for the kiosk (it has no printer set up yet),
 * `unknown` until a print agent has reported,
 * `unavailable` when its last report is stale, `attention` when it reported a problem (paper out, offline, an error) and
 * `available` when its last, recent report was fine.
 */
export function printerAvailability(
  device: { printsTickets: boolean; printerStatus: "unknown" | "none" | "ok" | "paper_out" | "offline" | "error"; printerHeartbeatAt: Date | null },
  now = new Date(),
): PrinterAvailability {
  if (!device.printsTickets || device.printerStatus === "none") return "none";
  if (!device.printerHeartbeatAt) return "unknown";
  if (now.getTime() - device.printerHeartbeatAt.getTime() > PRINTER_FRESH_MS) return "unavailable";
  return device.printerStatus === "ok" ? "available" : "attention";
}

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
export function newRegistrationReference(prefix: "KR" | "MR" = "KR"): string {
  const bytes = randomBytes(6);
  return `${prefix}-${[...bytes].map((b) => REFERENCE_ALPHABET[b % REFERENCE_ALPHABET.length]).join("")}`;
}

/** Pre-registrations from MyHealth (migration 0150): at most this many may wait per organization, and arrive per day. */
export const MAX_MYHEALTH_PENDING_PER_ORGANIZATION = 500;
export const MAX_MYHEALTH_PER_ORGANIZATION_PER_DAY = 200;

/**
 * A printer must be on the clinic's own network: a private, loopback or link-local address, or a local name (one label, or a
 * `.local`, `.lan` or `.internal` name). Never a public address, so a setting cannot point the print agent at the internet.
 */
export function isPrivateHost(host: string): boolean {
  const kind = isIP(host);
  if (kind === 4) {
    const [a = 0, b = 0] = host.split(".").map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (kind === 6) return host === "::1" || /^f[cd][0-9a-f]{2}:/i.test(host) || /^fe80:/i.test(host);
  return !host.includes(".") || /\.(local|lan|internal)$/i.test(host);
}

/** What is wrong with a printer host, in words for the person setting it up; null when it is fine. */
export function printerHostProblem(host: string): { code: "printer_host_invalid" | "printer_host_not_private"; message: string } | null {
  if (!/^[A-Za-z0-9._:[\]-]{1,253}$/.test(host)) {
    return {
      code: "printer_host_invalid",
      message: "Enter the printer's address or name: letters, digits, dots, hyphens or colons, with no spaces or slashes",
    };
  }
  if (!isPrivateHost(host)) {
    return {
      code: "printer_host_not_private",
      message: "The printer must be on the clinic's own network (a private address such as 192.168.1.50, or a local name)",
    };
  }
  return null;
}

export type DeviceHealth = "online" | "offline" | "maintenance" | "disabled";

/** What the monitoring list shows: an operator's status wins over the heartbeat. */
export function deviceHealth(device: { status: "active" | "maintenance" | "disabled"; heartbeatAt: Date | null }, now = new Date()): DeviceHealth {
  if (device.status !== "active") return device.status;
  return device.heartbeatAt && now.getTime() - device.heartbeatAt.getTime() <= DEVICE_ONLINE_MS ? "online" : "offline";
}

/** At most this many addresses or ranges per kiosk (the database checks it too). */
export const MAX_KIOSK_NETWORKS = 10;

/** "::ffff:203.0.113.7" → "203.0.113.7"; other addresses as given. */
function plainAddress(address: string): string {
  const lower = address.trim().toLowerCase();
  return lower.startsWith("::ffff:") && isIP(lower.slice(7)) === 4 ? lower.slice(7) : lower;
}

/**
 * A kiosk network entry, normalized: an address ("203.0.113.7") or a CIDR range ("203.0.113.0/24", "2001:db8::/48").
 * Null when it is neither. A single address is stored as written; a range keeps its prefix.
 */
export function normalizeKioskNetwork(value: string): string | null {
  const text = value.trim();
  const [address, prefix, extra] = text.split("/");
  if (!address || extra !== undefined) return null;
  const plain = plainAddress(address);
  const family = isIP(plain);
  if (family === 0) return null;
  if (prefix === undefined) return plain;
  if (!/^\d{1,3}$/.test(prefix)) return null;
  const bits = Number(prefix);
  if (bits > (family === 4 ? 32 : 128)) return null;
  return `${plain}/${bits}`;
}

/**
 * Zero trust for a kiosk's credential (audit F3): whether `address` (the client the request came from) is inside the
 * kiosk's allowed networks. An empty list allows any address; an unknown address is refused when a list is set.
 */
export function kioskNetworkAllowed(address: string | undefined, networks: readonly string[]): boolean {
  if (networks.length === 0) return true;
  if (!address) return false;
  const plain = plainAddress(address);
  const family = isIP(plain);
  if (family === 0) return false;
  const list = new BlockList();
  for (const entry of networks) {
    const normalized = normalizeKioskNetwork(entry);
    if (!normalized) continue;
    const [network, prefix] = normalized.split("/");
    const type = isIP(network!) === 4 ? "ipv4" : "ipv6";
    if (prefix === undefined) list.addAddress(network!, type);
    else list.addSubnet(network!, Number(prefix), type);
  }
  return list.check(plain, family === 4 ? "ipv4" : "ipv6");
}
