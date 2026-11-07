import { type AgentApi, ApiRefusedError, TransientApiError } from "./api";
import { ConfigError } from "./config";
import { renderTicket, type PaperWidth } from "./escpos";
import { agentJobSchema } from "./job";
import { type Printer, PrinterError, type PrinterState } from "./printer";

export interface AgentLogger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export interface AgentDeps {
  api: AgentApi;
  printer: Printer;
  deviceCodes: string[];
  paperWidth: PaperWidth;
  timeZone: string;
  log: AgentLogger;
  now?: () => Date;
}

/** What the health check says: nothing about tickets' content, only whether the agent and its printer are working. */
export interface AgentHealth {
  status: "ok" | "degraded";
  lastPollAt: string | null;
  lastPrintAt: string | null;
  lastError: string | null;
  printer: PrinterState | "unknown";
  printedSinceStart: number;
}

/** A ticket printed in the last hour is not printed again if the API offers it again (the report may have been lost). */
const REMEMBER_PRINTED_MS = 60 * 60_000;

/**
 * The print agent's work: for each kiosk it drives, ask the API for the next ticket, print it and report. It only pulls;
 * nothing can send it a job. A ticket the API offers again after this agent already printed it (the report did not get
 * through) is reported as printed without printing a second copy.
 */
export class Agent {
  private readonly printed = new Map<string, number>();
  private health: AgentHealth = { status: "ok", lastPollAt: null, lastPrintAt: null, lastError: null, printer: "unknown", printedSinceStart: 0 };
  private timers: NodeJS.Timeout[] = [];
  private stopped = true;
  private codes: string[];

  constructor(private readonly deps: AgentDeps) {
    this.codes = [...deps.deviceCodes];
  }

  /** The kiosks this agent serves now (the printer settings may add or remove one). */
  setDeviceCodes(codes: string[]): void {
    this.codes = [...codes];
  }

  getDeviceCodes(): string[] {
    return [...this.codes];
  }

  getHealth(): AgentHealth {
    return { ...this.health };
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /** One round: every kiosk's waiting tickets, until none is left (or a few, so one busy kiosk cannot starve the others). */
  async pollOnce(): Promise<number> {
    let printed = 0;
    for (const code of this.codes) {
      for (let i = 0; i < 5; i++) {
        const done = await this.handleNext(code);
        if (!done) break;
        printed += 1;
      }
    }
    this.health.lastPollAt = this.now().toISOString();
    return printed;
  }

  private async handleNext(deviceCode: string): Promise<boolean> {
    const answer = await this.deps.api.claim(deviceCode);
    if ("invalid" in answer) {
      // The API sent something that is not a ticket: never print it, say so when it can be identified.
      this.deps.log.error("agent.invalid_job", { deviceCode });
      if (answer.invalid) await this.safeReport(answer.invalid, { outcome: "failed", error: "error", retry: false });
      return false;
    }
    if (!answer.job) return false;

    const job = agentJobSchema.parse(answer.job);
    const seen = this.printed.get(job.id);
    if (seen !== undefined && this.now().getTime() - seen < REMEMBER_PRINTED_MS) {
      this.deps.log.warn("agent.already_printed", { jobId: job.id });
      await this.safeReport(job.id, { outcome: "printed" });
      return true;
    }

    try {
      const bytes = renderTicket({ ...job, issuedAt: new Date(job.issuedAt) }, { width: this.deps.paperWidth, timeZone: this.deps.timeZone });
      await this.deps.printer.send(bytes);
    } catch (error) {
      const code = error instanceof PrinterError ? error.code : "error";
      this.health.lastError = code;
      this.health.printer = code;
      this.deps.log.warn("agent.print_failed", { jobId: job.id, attempt: job.attempt, error: code });
      // A cable, a jam or a roll that runs out is usually fixed within the ticket's few minutes: ask for a retry.
      await this.safeReport(job.id, { outcome: "failed", error: code, retry: true });
      return false;
    }

    this.printed.set(job.id, this.now().getTime());
    this.forgetOld();
    this.health.lastPrintAt = this.now().toISOString();
    this.health.printedSinceStart += 1;
    this.health.printer = "ok";
    this.health.lastError = null;
    this.deps.log.info("agent.printed", { jobId: job.id, attempt: job.attempt });
    await this.safeReport(job.id, { outcome: "printed" });
    return true;
  }

  private async safeReport(jobId: string, result: Parameters<AgentApi["report"]>[1]): Promise<void> {
    try {
      await this.deps.api.report(jobId, result);
    } catch (error) {
      // The ticket is printed (or not) either way; the API will offer it again after its lease if it never heard.
      this.deps.log.warn("agent.report_failed", { jobId, error: error instanceof Error ? error.message : String(error) });
    }
  }

  private forgetOld(): void {
    const cutoff = this.now().getTime() - REMEMBER_PRINTED_MS;
    for (const [id, at] of this.printed) if (at < cutoff) this.printed.delete(id);
  }

  /** Tells the API how the printer is, once per kiosk it drives. */
  async heartbeatOnce(): Promise<PrinterState> {
    const state = await this.deps.printer.status();
    this.health.printer = state;
    for (const code of this.codes) await this.deps.api.heartbeat(code, state);
    return state;
  }

  /** Starts polling and reporting; stops for good only on a configuration problem the operator must fix. */
  start(pollMs: number, heartbeatMs: number, onFatal: (error: ConfigError) => void): void {
    this.stopped = false;
    const guarded = async (name: string, work: () => Promise<unknown>) => {
      try {
        await work();
        if (name === "poll") this.health.status = "ok";
      } catch (error) {
        if (error instanceof ConfigError) return onFatal(error);
        this.health.status = "degraded";
        this.health.lastError = error instanceof Error ? error.message : String(error);
        const level = error instanceof TransientApiError || error instanceof ApiRefusedError ? "warn" : "error";
        this.deps.log[level](`agent.${name}_failed`, { error: this.health.lastError });
      }
    };
    const loop = (name: string, work: () => Promise<unknown>, every: number) => {
      const tick = async () => {
        if (this.stopped) return;
        await guarded(name, work);
        if (!this.stopped) this.timers.push(setTimeout(() => void tick(), every).unref());
      };
      void tick();
    };
    loop("poll", () => this.pollOnce(), pollMs);
    loop("heartbeat", () => this.heartbeatOnce(), heartbeatMs);
  }

  stop(): void {
    this.stopped = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }
}
