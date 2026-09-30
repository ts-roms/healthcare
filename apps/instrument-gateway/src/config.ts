/**
 * Instrument gateway configuration, from the environment (docs/domains/laboratory-instruments.md, "Instrument gateway").
 *
 * GATEWAY_API_URL        the platform API, e.g. https://api.example.ph/api/v1
 * GATEWAY_EMAIL          the integration account (a role holding lab.instrument.message.submit; no MFA)
 * GATEWAY_PASSWORD
 * GATEWAY_ORGANIZATION_ID  only when the account belongs to more than one organization
 * GATEWAY_INSTRUMENTS    JSON: [{ "instrumentId": "<uuid>", "protocol": "hl7v2" | "astm", "port": 5001, "host": "0.0.0.0" }]
 */
export interface InstrumentListener {
  instrumentId: string;
  protocol: "hl7v2" | "astm";
  port: number;
  host: string;
}

export interface GatewayConfig {
  apiUrl: string;
  email: string;
  password: string;
  organizationId?: string;
  instruments: InstrumentListener[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function loadConfig(env: NodeJS.ProcessEnv): GatewayConfig {
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`${name} is required`);
    return value;
  };
  const apiUrl = required("GATEWAY_API_URL").replace(/\/+$/, "");
  if (!/^https?:\/\//.test(apiUrl)) throw new Error("GATEWAY_API_URL must be an http(s) URL");
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
    return { instrumentId: e.instrumentId, protocol: e.protocol, port: e.port as number, host: typeof e.host === "string" && e.host ? e.host : "0.0.0.0" };
  });
  return {
    apiUrl,
    email: required("GATEWAY_EMAIL"),
    password: required("GATEWAY_PASSWORD"),
    organizationId: env["GATEWAY_ORGANIZATION_ID"]?.trim() || undefined,
    instruments,
  };
}
