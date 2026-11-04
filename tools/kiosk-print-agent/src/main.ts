import { Agent, type AgentLogger } from "./agent";
import { AgentApi } from "./api";
import { ConfigError, loadConfig } from "./config";
import { previewBytes } from "./escpos";
import { startHealthServer } from "./health";
import { createPrinter } from "./printer";

/** One JSON object per line, like the platform's own services; nothing about a ticket's content is logged. */
const log: AgentLogger = {
  info: (event, fields) => console.log(JSON.stringify({ level: "info", event, ...fields, at: new Date().toISOString() })),
  warn: (event, fields) => console.warn(JSON.stringify({ level: "warn", event, ...fields, at: new Date().toISOString() })),
  error: (event, fields) => console.error(JSON.stringify({ level: "error", event, ...fields, at: new Date().toISOString() })),
};

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const api = new AgentApi({
    baseUrl: config.apiBaseUrl,
    email: config.email,
    password: config.password,
    facilityId: config.facilityId,
    organizationId: config.organizationId,
  });
  // The dry-run printer keeps a readable copy of each ticket beside its raw bytes.
  const printer = createPrinter(config.printer, previewBytes);
  const agent = new Agent({ api, printer, deviceCodes: config.deviceCodes, paperWidth: config.paperWidth, timeZone: config.timeZone, log });

  const health = await startHealthServer(config.healthPort, () => agent.getHealth());
  log.info("agent.started", { devices: config.deviceCodes, printer: config.printer.type, paper: config.paperWidth, health: `127.0.0.1:${config.healthPort}` });

  const shutdown = (signal: string) => {
    log.info("agent.stopping", { signal });
    agent.stop();
    health.close(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  agent.start(config.pollMs, config.heartbeatMs, (error) => {
    log.error("agent.fatal", { error: error.message });
    agent.stop();
    health.close(() => process.exit(1));
  });
}

main().catch((error) => {
  if (error instanceof ConfigError) log.error("agent.config_error", { error: error.message });
  else log.error("agent.crashed", { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
