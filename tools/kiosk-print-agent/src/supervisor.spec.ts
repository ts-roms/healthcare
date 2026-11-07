import { ConfigError } from "./config";
import type { PrintConfig } from "./api";
import type { Printer } from "./printer";
import { Supervisor, type SupervisorDeps } from "./supervisor";

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };

type Kiosk = PrintConfig["kiosks"][number];
const kiosk = (code: string, over: Partial<Kiosk> = {}): Kiosk => ({
  code,
  printsTickets: true,
  connection: "network",
  host: "192.168.1.50",
  port: null,
  paperMm: 80,
  ...over,
});

class FakeApi {
  config = async (): Promise<PrintConfig> => {
    if (this.fail) throw this.fail;
    return this.answer;
  };
  claim = async () => ({ job: null }) as const;
  report = async () => undefined;
  heartbeat = async () => undefined;
  fail: Error | null = null;
  constructor(public answer: PrintConfig) {}
}

function setup(answer: PrintConfig, over: Partial<SupervisorDeps> = {}) {
  const api = new FakeApi(answer);
  const created: Array<unknown> = [];
  const fatal: ConfigError[] = [];
  const printer: Printer = { send: async () => undefined, status: async () => "ok" };
  const supervisor = new Supervisor(
    {
      api: api as unknown as SupervisorDeps["api"],
      localPrinter: null,
      onlyCodes: null,
      timeZoneOverride: null,
      createPrinter: (config) => {
        created.push(config);
        return printer;
      },
      pollMs: 60_000,
      heartbeatMs: 60_000,
      refreshMs: 60_000,
      log: silent,
      ...over,
    },
    (error) => fatal.push(error),
  );
  return { api, supervisor, created, fatal };
}

const devices = (s: Supervisor) => [...(s as unknown as { groups: Map<string, { group: { codes: string[] } }> }).groups.values()].map((g) => g.group.codes);

describe("the supervisor", () => {
  it("runs one agent per distinct printer, so kiosks that share a printer are served together", async () => {
    const { api, supervisor, created } = setup({
      timeZone: "Asia/Manila",
      kiosks: [kiosk("front-1"), kiosk("front-2"), kiosk("side-3", { host: "192.168.1.51" }), kiosk("wide-4", { paperMm: 58 })],
    });
    await supervisor.refresh();
    expect(devices(supervisor).sort()).toEqual([["front-1", "front-2"], ["side-3"], ["wide-4"]]);
    expect(created).toHaveLength(3);
    expect(created[0]).toEqual({ type: "tcp", host: "192.168.1.50", port: 9100 });
    supervisor.stop();
    expect(api).toBeDefined();
  });

  it("serves only kiosks that print tickets, and only those it was told to when told", async () => {
    const answer = { timeZone: "Asia/Manila", kiosks: [kiosk("front-1"), kiosk("front-2", { printsTickets: false }), kiosk("side-3")] };
    const all = setup(answer);
    await all.supervisor.refresh();
    expect(devices(all.supervisor)).toEqual([["front-1", "side-3"]]);
    all.supervisor.stop();

    const only = setup(answer, { onlyCodes: ["side-3"] });
    await only.supervisor.refresh();
    expect(devices(only.supervisor)).toEqual([["side-3"]]);
    only.supervisor.stop();
  });

  it("follows a change in the settings: a kiosk added, a printer moved, a kiosk switched off", async () => {
    const { api, supervisor, created } = setup({ timeZone: "Asia/Manila", kiosks: [kiosk("front-1")] });
    await supervisor.refresh();
    expect(devices(supervisor)).toEqual([["front-1"]]);

    api.answer = { timeZone: "Asia/Manila", kiosks: [kiosk("front-1"), kiosk("front-2")] };
    await supervisor.refresh();
    expect(devices(supervisor)).toEqual([["front-1", "front-2"]]);
    // The same printer: no second agent and no new printer object.
    expect(created).toHaveLength(1);

    api.answer = { timeZone: "Asia/Manila", kiosks: [kiosk("front-1", { host: "printer-9.local" }), kiosk("front-2", { printsTickets: false })] };
    await supervisor.refresh();
    expect(devices(supervisor)).toEqual([["front-1"]]);
    expect(created.at(-1)).toEqual({ type: "tcp", host: "printer-9.local", port: 9100 });

    api.answer = { timeZone: "Asia/Manila", kiosks: [] };
    await supervisor.refresh();
    expect(devices(supervisor)).toEqual([]);
    supervisor.stop();
  });

  it("uses the printer on this computer only when it has one, and says so when it does not", async () => {
    const answer = { timeZone: "Asia/Manila", kiosks: [kiosk("front-1", { connection: "agent_local", host: null })] };
    const without = setup(answer);
    await without.supervisor.refresh();
    expect(devices(without.supervisor)).toEqual([]);
    without.supervisor.stop();

    const withLocal = setup(answer, { localPrinter: { type: "file", path: "/dev/usb/lp0" } });
    await withLocal.supervisor.refresh();
    expect(devices(withLocal.supervisor)).toEqual([["front-1"]]);
    expect(withLocal.created).toEqual([{ type: "file", path: "/dev/usb/lp0" }]);
    withLocal.supervisor.stop();
  });

  it("never prints to an address outside the clinic's network, whatever the settings say", async () => {
    const { supervisor, created } = setup({ timeZone: "Asia/Manila", kiosks: [kiosk("front-1", { host: "203.0.113.9" }), kiosk("side-2")] });
    await supervisor.refresh();
    expect(devices(supervisor)).toEqual([["side-2"]]);
    expect(JSON.stringify(created)).not.toContain("203.0.113.9");
    supervisor.stop();
  });

  it("keeps working when the settings cannot be read, and stops for a problem only the operator can fix", async () => {
    const { api, supervisor, fatal } = setup({ timeZone: "Asia/Manila", kiosks: [kiosk("front-1")] });
    await supervisor.refresh();
    api.fail = new Error("The API could not be reached");
    await supervisor.refresh();
    expect(devices(supervisor)).toEqual([["front-1"]]);
    expect(supervisor.getHealth()).toMatchObject({ status: "degraded", lastError: "The API could not be reached" });

    api.fail = new ConfigError("The agent's account works at several facilities: set FACILITY_ID");
    await supervisor.refresh();
    expect(fatal).toHaveLength(1);
    supervisor.stop();
  });

  it("reports one health: alive after a settings answer even with nothing to print yet", async () => {
    const { supervisor } = setup({ timeZone: "Asia/Manila", kiosks: [] }, { now: () => new Date("2026-11-05T01:00:00Z") });
    expect(supervisor.getHealth()).toMatchObject({ lastPollAt: null, printer: "unknown", printedSinceStart: 0 });
    await supervisor.refresh();
    expect(supervisor.getHealth()).toMatchObject({ status: "ok", lastPollAt: "2026-11-05T01:00:00.000Z" });
    supervisor.stop();
  });
});
