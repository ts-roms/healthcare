import { readFileSync } from "node:fs";
import { isIP } from "node:net";

/**
 * Instrument gateway configuration, from the environment (docs/domains/laboratory-instruments.md, "Instrument gateway").
 *
 * GATEWAY_API_URL        the platform API over https, e.g. https://api.example.ph/api/v1 (http only for a loopback address)
 * GATEWAY_EMAIL          the integration account: the built-in role `instrument_gateway` only (no MFA; migration 0145)
 * GATEWAY_PASSWORD       or GATEWAY_PASSWORD_FILE, a file holding it (kept out of the process environment)
 * GATEWAY_ORGANIZATION_ID  only when the account belongs to more than one organization
 * GATEWAY_INSTRUMENTS    JSON: [{ "instrumentId": "<uuid>", "protocol": "hl7v2" | "astm", "port": 5001, "host": "0.0.0.0",
 *                        "allowedPeers": ["192.168.10.21"] }] — allowedPeers (required) are the analyzer's own addresses:
 *                        a connection from anywhere else is closed before a byte is read.
 */
export interface InstrumentListener {
  instrumentId: string;
  protocol: "hl7v2" | "astm";
  port: number;
  host: string;
  /** IP addresses allowed to connect (normalized: no IPv4-mapped IPv6 prefix). */
  allowedPeers: string[];
}

export interface GatewayConfig {
  apiUrl: string;
  email: string;
  password: string;
  organizationId?: string;
  instruments: InstrumentListener[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "::ffff:192.168.1.5" → "192.168.1.5"; other addresses lower-cased as given. */
export function normalizePeer(address: string): string {
  const lower = address.trim().toLowerCase();
  return lower.startsWith("::ffff:") && isIP(lower.slice(7)) === 4 ? lower.slice(7) : lower;
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host === "::1" || /^127\./.test(host);
}

export function loadConfig(env: NodeJS.ProcessEnv, readFile: (path: string) => string = (path) => readFileSync(path, "utf8")): GatewayConfig {
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`${name} is required`);
    return value;
  };
  const apiUrl = required("GATEWAY_API_URL").replace(/\/+$/, "");
  let api: URL;
  try {
    api = new URL(apiUrl);
  } catch {
    throw new Error("GATEWAY_API_URL must be an http(s) URL");
  }
  // Results and the account's password travel on this hop: never in clear text beyond this machine.
  if (api.protocol !== "https:" && !(api.protocol === "http:" && isLoopbackHost(api.hostname)))
    throw new Error("GATEWAY_API_URL must use https (http only for a loopback address)");
  let parsed: unknown;
  try {
    parsed = JSON.parse(required("GATEWAY_INSTRUMENTS"));
  } catch {
    throw new Error("GATEWAY_INSTRUMENTS must be JSON");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("GATEWAY_INSTRUMENTS must list at least one instrument");
  const ports = new Set<number>();
  const instruments = parsed.map((entry, index): InstrumentListener => {
    const e = entry as Partial<InstrumentListener>;
    if (typeof e.instrumentId !== "string" || !UUID.test(e.instrumentId))
      throw new Error(`GATEWAY_INSTRUMENTS[${index}].instrumentId must be the instrument's id`);
    if (e.protocol !== "hl7v2" && e.protocol !== "astm") throw new Error(`GATEWAY_INSTRUMENTS[${index}].protocol must be hl7v2 or astm`);
    if (!Number.isInteger(e.port) || (e.port as number) < 1 || (e.port as number) > 65535)
      throw new Error(`GATEWAY_INSTRUMENTS[${index}].port must be a TCP port`);
    if (ports.has(e.port as number)) throw new Error(`GATEWAY_INSTRUMENTS: port ${e.port} is used twice`);
    ports.add(e.port as number);
    const peers = (entry as { allowedPeers?: unknown }).allowedPeers;
    if (!Array.isArray(peers) || peers.length === 0 || !peers.every((p) => typeof p === "string" && isIP(normalizePeer(p)) !== 0))
      throw new Error(`GATEWAY_INSTRUMENTS[${index}].allowedPeers must list the analyzer's IP addresses`);
    return {
      instrumentId: e.instrumentId,
      protocol: e.protocol,
      port: e.port as number,
      host: typeof e.host === "string" && e.host ? e.host : "0.0.0.0",
      allowedPeers: [...new Set((peers as string[]).map(normalizePeer))],
    };
  });
  const passwordFile = env["GATEWAY_PASSWORD_FILE"]?.trim();
  let password: string;
  if (passwordFile) {
    password = readFile(passwordFile).trim();
    if (!password) throw new Error("GATEWAY_PASSWORD_FILE is empty");
  } else {
    password = required("GATEWAY_PASSWORD");
  }
  return {
    apiUrl,
    email: required("GATEWAY_EMAIL"),
    password,
    organizationId: env["GATEWAY_ORGANIZATION_ID"]?.trim() || undefined,
    instruments,
  };
}
