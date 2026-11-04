import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import { z } from "zod";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** A printer must be on the clinic's own network: a private or loopback address, or a local name. Never a public address. */
export function isPrivateHost(host: string): boolean {
  const kind = isIP(host);
  if (kind === 4) {
    const [a = 0, b = 0] = host.split(".").map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (kind === 6) return host === "::1" || /^f[cd][0-9a-f]{2}:/i.test(host) || /^fe80:/i.test(host);
  // A name: a single label ("receipt-printer") or a ".local" / ".lan" name resolves on the clinic's network.
  return !host.includes(".") || /\.(local|lan|internal)$/i.test(host);
}

const deviceCode = z.string().regex(/^[a-z0-9][a-z0-9-]{2,39}$/, "a kiosk code is 3-40 lower-case letters, digits or hyphens");

const envSchema = z.object({
  API_BASE_URL: z.url(),
  AGENT_EMAIL: z.email(),
  AGENT_PASSWORD: z.string().min(1).optional(),
  AGENT_PASSWORD_FILE: z.string().min(1).optional(),
  ORGANIZATION_ID: z.uuid().optional(),
  FACILITY_ID: z.uuid(),
  DEVICE_CODES: z
    .string()
    .transform((v) =>
      v
        .split(",")
        .map((c) => c.trim().toLowerCase())
        .filter(Boolean),
    )
    .pipe(z.array(deviceCode).min(1).max(10)),
  PRINTER_TYPE: z.enum(["tcp", "file", "dryrun"]),
  PRINTER_HOST: z.string().optional(),
  PRINTER_PORT: z.coerce.number().int().min(1).max(65535).default(9100),
  PRINTER_PATH: z.string().optional(),
  DRYRUN_DIR: z.string().default("./printed"),
  PAPER_MM: z.coerce
    .number()
    .pipe(z.union([z.literal(58), z.literal(80)]))
    .default(80),
  TIMEZONE: z.string().default("Asia/Manila"),
  POLL_MS: z.coerce.number().int().min(500).max(60_000).default(2_000),
  HEARTBEAT_MS: z.coerce.number().int().min(5_000).max(300_000).default(30_000),
  HEALTH_PORT: z.coerce.number().int().min(1024).max(65535).default(8788),
});

export interface AgentConfig {
  apiBaseUrl: string;
  email: string;
  password: string;
  organizationId?: string;
  facilityId: string;
  deviceCodes: string[];
  printer: { type: "tcp"; host: string; port: number } | { type: "file"; path: string } | { type: "dryrun"; dir: string };
  paperWidth: 58 | 80;
  timeZone: string;
  pollMs: number;
  heartbeatMs: number;
  healthPort: number;
}

/**
 * The agent's settings, from its environment, checked before anything starts. Refused: an API address that is not https (http
 * only for this machine), a printer outside the clinic's network, no password, a time zone the system does not know.
 */
export function loadConfig(env: NodeJS.ProcessEnv, readFile: (path: string) => string = (p) => readFileSync(p, "utf8")): AgentConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join(".") || "settings"}: ${i.message}`).join("; "));
  }
  const v = parsed.data;

  const api = new URL(v.API_BASE_URL);
  const local = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(api.hostname);
  if (api.protocol !== "https:" && !(api.protocol === "http:" && local)) {
    throw new ConfigError("API_BASE_URL must use https (http is allowed only for localhost)");
  }

  const password = v.AGENT_PASSWORD ?? (v.AGENT_PASSWORD_FILE ? readFile(v.AGENT_PASSWORD_FILE).trim() : undefined);
  if (!password) throw new ConfigError("Set AGENT_PASSWORD or AGENT_PASSWORD_FILE (a file is better: it keeps the password out of the process list)");

  try {
    new Intl.DateTimeFormat("en", { timeZone: v.TIMEZONE });
  } catch {
    throw new ConfigError(`TIMEZONE "${v.TIMEZONE}" is not a known time zone`);
  }

  let printer: AgentConfig["printer"];
  if (v.PRINTER_TYPE === "tcp") {
    if (!v.PRINTER_HOST) throw new ConfigError("PRINTER_HOST is required for a network printer");
    if (!isPrivateHost(v.PRINTER_HOST)) throw new ConfigError("PRINTER_HOST must be on the clinic's own network (a private address or a local name)");
    printer = { type: "tcp", host: v.PRINTER_HOST, port: v.PRINTER_PORT };
  } else if (v.PRINTER_TYPE === "file") {
    if (!v.PRINTER_PATH) throw new ConfigError("PRINTER_PATH is required for a printer reached through the operating system");
    printer = { type: "file", path: v.PRINTER_PATH };
  } else {
    printer = { type: "dryrun", dir: v.DRYRUN_DIR };
  }

  return {
    apiBaseUrl: api.toString().replace(/\/+$/, ""),
    email: v.AGENT_EMAIL,
    password,
    organizationId: v.ORGANIZATION_ID,
    facilityId: v.FACILITY_ID,
    deviceCodes: v.DEVICE_CODES,
    printer,
    paperWidth: v.PAPER_MM,
    timeZone: v.TIMEZONE,
    pollMs: v.POLL_MS,
    heartbeatMs: v.HEARTBEAT_MS,
    healthPort: v.HEALTH_PORT,
  };
}
