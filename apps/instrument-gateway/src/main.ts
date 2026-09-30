import { PlatformClient } from "./api-client";
import { loadConfig } from "./config";
import { astmListener, hl7Listener } from "./listeners";

/**
 * The on-site instrument gateway: listens for analyzers on TCP (HL7 v2 over MLLP, or ASTM E1381) and posts each result
 * message to the platform, where it waits for review. It keeps nothing: patient data is not stored on the gateway.
 */
function log(event: string, detail: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), event, ...detail })}\n`);
}

const config = loadConfig(process.env);
const client = new PlatformClient(config);
for (const instrument of config.instruments) {
  const server = instrument.protocol === "hl7v2" ? hl7Listener(instrument, client, log) : astmListener(instrument, client, log);
  server.listen(instrument.port, instrument.host, () =>
    log("listening", { instrumentId: instrument.instrumentId, protocol: instrument.protocol, port: instrument.port }),
  );
}
