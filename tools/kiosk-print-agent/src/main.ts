import type { AgentLogger } from "./agent";
import { AgentApi } from "./api";
import { ConfigError, loadConfig } from "./config";
import { previewBytes } from "./escpos";
import { startHealthServer } from "./health";
import { createPrinter } from "./printer";
import { Supervisor } from "./supervisor";

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

  let stopAll = () => undefined;
  const fatal = (error: ConfigError) => {
    log.error("agent.fatal", { error: error.message });
    stopAll();
    process.exit(1);
  };
  // Which kiosks print, where each network printer is and the paper width come from the staff app (Queue → Devices); this
  // machine's environment holds only how to reach the API and the printer connected to this computer, if any.
  const supervisor = new Supervisor(
    {
      api,
      localPrinter: config.localPrinter,
      onlyCodes: config.deviceCodes,
      timeZoneOverride: config.timeZone,
      // The dry-run printer keeps a readable copy of each ticket beside its raw bytes.
      createPrinter: (printer) => createPrinter(printer, previewBytes),
      pollMs: config.pollMs,
      heartbeatMs: config.heartbeatMs,
      refreshMs: config.configRefreshMs,
      log,
    },
    fatal,
  );

  const health = await startHealthServer(config.healthPort, () => supervisor.getHealth());
  log.info("agent.started", {
    local: config.localPrinter?.type ?? "none",
    only: config.deviceCodes ?? "all kiosks that print",
    health: `127.0.0.1:${config.healthPort}`,
  });

  stopAll = () => {
    supervisor.stop();
    health.close();
  };
  const shutdown = (signal: string) => {
    log.info("agent.stopping", { signal });
    supervisor.stop();
    health.close(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  supervisor.start();
}

main().catch((error) => {
  if (error instanceof ConfigError) log.error("agent.config_error", { error: error.message });
  else log.error("agent.crashed", { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
