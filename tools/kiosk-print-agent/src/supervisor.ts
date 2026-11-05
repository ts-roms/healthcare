import { Agent, type AgentHealth, type AgentLogger } from "./agent";
import { ApiRefusedError, type AgentApi, type PrintConfig, TransientApiError } from "./api";
import { ConfigError, isPrivateHost, type PrinterConfig } from "./config";
import type { PaperWidth } from "./escpos";
import type { Printer, PrinterState } from "./printer";

export interface SupervisorDeps {
  api: Pick<AgentApi, "claim" | "report" | "heartbeat" | "config">;
  /** The printer connected to this computer, for kiosks whose settings say "the printer on the agent's computer". */
  localPrinter: PrinterConfig | null;
  /** Serve only these kiosks; null serves every kiosk that prints tickets. */
  onlyCodes: string[] | null;
  /** Overrides the facility's time zone on the ticket; null uses the facility's. */
  timeZoneOverride: string | null;
  createPrinter: (config: PrinterConfig) => Printer;
  pollMs: number;
  heartbeatMs: number;
  refreshMs: number;
  log: AgentLogger;
  now?: () => Date;
}

/** One printer and the kiosks that use it: kiosks that share a printer are served by one agent. */
interface Group {
  key: string;
  printer: PrinterConfig;
  paperWidth: PaperWidth;
  timeZone: string;
  codes: string[];
}

const WORST: Record<PrinterState | "unknown", number> = { ok: 0, unknown: 1, error: 2, offline: 3, paper_out: 4 };

/**
 * Keeps the print agents in line with the printer settings of the staff app. It asks the API which kiosks print and where
 * each printer is (a network printer's address, or the printer on this computer), and runs one agent for each distinct printer
 * and roll width; when staff change a setting the next refresh starts, stops or changes the agents. Nothing about a printer is
 * taken on trust: an address outside the clinic's network is refused here too, and a kiosk that uses "the printer on this
 * computer" needs one set in this machine's own environment.
 */
export class Supervisor {
  private readonly groups = new Map<string, { group: Group; agent: Agent }>();
  private timer: NodeJS.Timeout | null = null;
  private stopped = true;
  private lastRefreshAt: string | null = null;
  private lastError: string | null = null;
  /** Prints counted by agents that have since been stopped, so the total never goes backwards. */
  private retiredPrinted = 0;
  private warned = new Set<string>();

  constructor(
    private readonly deps: SupervisorDeps,
    private readonly onFatal: (error: ConfigError) => void,
  ) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private warnOnce(key: string, event: string, fields: Record<string, unknown>): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.deps.log.warn(event, fields);
  }

  /** The agents the printer settings call for. */
  private plan(config: PrintConfig): Group[] {
    const groups = new Map<string, Group>();
    const timeZone = this.deps.timeZoneOverride ?? config.timeZone;
    for (const kiosk of config.kiosks) {
      if (!kiosk.printsTickets) continue;
      if (this.deps.onlyCodes && !this.deps.onlyCodes.includes(kiosk.code)) continue;
      let printer: PrinterConfig | null;
      if (kiosk.connection === "network") {
        if (!kiosk.host || !isPrivateHost(kiosk.host)) {
          this.warnOnce(`refused:${kiosk.code}:${kiosk.host}`, "agent.printer_refused", { deviceCode: kiosk.code, reason: "not_on_the_clinics_network" });
          continue;
        }
        printer = { type: "tcp", host: kiosk.host, port: kiosk.port ?? 9100 };
      } else {
        printer = this.deps.localPrinter;
        if (!printer) {
          this.warnOnce(`nolocal:${kiosk.code}`, "agent.no_local_printer", {
            deviceCode: kiosk.code,
            hint: "this kiosk uses the printer on the agent's computer: set PRINTER_TYPE here, or choose a network printer for it in the staff app",
          });
          continue;
        }
      }
      const key = `${JSON.stringify(printer)}|${kiosk.paperMm}|${timeZone}`;
      const group = groups.get(key) ?? { key, printer, paperWidth: kiosk.paperMm, timeZone, codes: [] };
      group.codes.push(kiosk.code);
      groups.set(key, group);
    }
    return [...groups.values()];
  }

  /** Asks the API for the printer settings and brings the agents in line with them. A failed ask changes nothing. */
  async refresh(): Promise<void> {
    let config: PrintConfig;
    try {
      config = await this.deps.api.config();
    } catch (error) {
      if (error instanceof ConfigError) return this.onFatal(error);
      this.lastError = error instanceof Error ? error.message : String(error);
      const level = error instanceof TransientApiError || error instanceof ApiRefusedError ? "warn" : "error";
      this.deps.log[level]("agent.config_failed", { error: this.lastError });
      return;
    }
    this.lastError = null;
    this.lastRefreshAt = this.now().toISOString();

    const wanted = new Map(this.plan(config).map((g) => [g.key, g]));
    for (const [key, running] of [...this.groups]) {
      if (!wanted.has(key)) {
        this.retiredPrinted += running.agent.getHealth().printedSinceStart;
        running.agent.stop();
        this.groups.delete(key);
        this.deps.log.info("agent.printer_removed", { devices: running.group.codes });
      }
    }
    for (const [key, group] of wanted) {
      const running = this.groups.get(key);
      if (running) {
        if (running.group.codes.join() !== group.codes.join()) {
          running.agent.setDeviceCodes(group.codes);
          running.group = group;
          this.deps.log.info("agent.devices_changed", { devices: group.codes });
        }
        continue;
      }
      const agent = new Agent({
        api: this.deps.api as unknown as AgentApi,
        printer: this.deps.createPrinter(group.printer),
        deviceCodes: group.codes,
        paperWidth: group.paperWidth,
        timeZone: group.timeZone,
        log: this.deps.log,
        ...(this.deps.now ? { now: this.deps.now } : {}),
      });
      this.groups.set(key, { group, agent });
      agent.start(this.deps.pollMs, this.deps.heartbeatMs, (error) => this.onFatal(error));
      this.deps.log.info("agent.printer_added", { devices: group.codes, printer: group.printer.type, paper: group.paperWidth });
    }
  }

  /** Reads the settings now, and again every refresh interval. */
  start(): void {
    this.stopped = false;
    const tick = async () => {
      if (this.stopped) return;
      await this.refresh();
      // After a failed ask (the API busy, or refusing a sign-in), try again soon instead of waiting out the whole interval.
      const every = this.lastError ? Math.min(this.deps.refreshMs, 5_000) : this.deps.refreshMs;
      if (!this.stopped) this.timer = setTimeout(() => void tick(), every).unref();
    };
    void tick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const { agent } of this.groups.values()) agent.stop();
  }

  /** What the health check says: all the agents together (the worst printer state, the latest times, the prints counted). */
  getHealth(): AgentHealth {
    const agents = [...this.groups.values()].map((g) => g.agent.getHealth());
    const latest = (values: Array<string | null>) =>
      values
        .filter((v): v is string => v !== null)
        .sort()
        .at(-1) ?? null;
    let printer: PrinterState | "unknown" = agents.length === 0 ? "unknown" : "ok";
    for (const a of agents) if (WORST[a.printer] > WORST[printer]) printer = a.printer;
    const degraded = this.lastError !== null || agents.some((a) => a.status === "degraded");
    return {
      status: degraded ? "degraded" : "ok",
      // With no agent running yet (nothing prints, or the first answer has not come), a settings refresh counts as the agent being alive.
      lastPollAt: agents.length > 0 ? latest(agents.map((a) => a.lastPollAt)) : this.lastRefreshAt,
      lastPrintAt: latest(agents.map((a) => a.lastPrintAt)),
      lastError: this.lastError ?? agents.map((a) => a.lastError).find((e) => e !== null) ?? null,
      printer,
      printedSinceStart: this.retiredPrinted + agents.reduce((n, a) => n + a.printedSinceStart, 0),
    };
  }
}
