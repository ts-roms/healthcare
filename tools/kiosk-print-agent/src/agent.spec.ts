import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, type AgentLogger } from "./agent";
import type { AgentApi, PrintOutcome } from "./api";
import { previewBytes } from "./escpos";
import { DryRunPrinter, type PrinterState } from "./printer";

const silent: AgentLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

const goodJob = (id: string, ticket = "A-001") => ({
  id,
  attempt: 1,
  ticket,
  serviceName: "Consultation",
  facilityName: "Barangay Health Center",
  issuedAt: "2026-11-04T01:30:00.000Z",
  instructions: "Please take a seat.",
});
const ID1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** A stand-in for the API: serves queued answers per kiosk and records what the agent reports. */
class FakeApi {
  claims = new Map<string, unknown[]>();
  reports: Array<{ id: string; result: PrintOutcome }> = [];
  beats: Array<{ code: string; state: PrinterState }> = [];
  failReports = false;

  queue(code: string, ...answers: unknown[]) {
    this.claims.set(code, [...(this.claims.get(code) ?? []), ...answers]);
  }
  async claim(code: string) {
    const answer = (this.claims.get(code) ?? []).shift() as { job?: unknown; invalid?: string | null } | undefined;
    return answer ?? { job: null };
  }
  async report(id: string, result: PrintOutcome) {
    if (this.failReports) throw new Error("API down");
    this.reports.push({ id, result });
  }
  async heartbeat(code: string, state: PrinterState) {
    this.beats.push({ code, state });
  }
}

async function setup(codes = ["front-1"]) {
  const dir = await mkdtemp(join(tmpdir(), "agent-"));
  const api = new FakeApi();
  const printer = new DryRunPrinter(dir, previewBytes);
  const agent = new Agent({ api: api as unknown as AgentApi, printer, deviceCodes: codes, paperWidth: 80, timeZone: "Asia/Manila", log: silent });
  return { dir, api, printer, agent };
}

describe("the print agent", () => {
  it("prints a claimed ticket and reports it printed", async () => {
    const { dir, api, agent } = await setup();
    api.queue("front-1", { job: goodJob(ID1, "A-007") });
    expect(await agent.pollOnce()).toBe(1);
    expect(api.reports).toEqual([{ id: ID1, result: { outcome: "printed" } }]);
    const files = await readdir(dir);
    expect(files.sort()).toEqual(["ticket-0001.bin", "ticket-0001.txt"]);
    expect(await readFile(join(dir, "ticket-0001.txt"), "utf8")).toContain("A-007");
    expect(agent.getHealth()).toMatchObject({ printedSinceStart: 1, printer: "ok", lastError: null });
  });

  it("serves every kiosk it drives, and drains one kiosk's queue before moving on", async () => {
    const { api, agent } = await setup(["front-1", "side-2"]);
    api.queue("front-1", { job: goodJob(ID1, "A-001") }, { job: goodJob(ID2, "A-002") });
    api.queue("side-2", { job: goodJob("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "A-003") });
    expect(await agent.pollOnce()).toBe(3);
    expect(api.reports.map((r) => r.id)).toEqual([ID1, ID2, "cccccccc-cccc-4ccc-8ccc-cccccccccccc"]);
  });

  it("says why a print failed, with the cause, and asks for a retry", async () => {
    const { api, printer, agent } = await setup();
    printer.failWith = "paper_out";
    api.queue("front-1", { job: goodJob(ID1) });
    expect(await agent.pollOnce()).toBe(0);
    expect(api.reports).toEqual([{ id: ID1, result: { outcome: "failed", error: "paper_out", retry: true } }]);
    expect(agent.getHealth()).toMatchObject({ printer: "paper_out", lastError: "paper_out" });
  });

  it("never prints something that is not a ticket, and refuses it by id when it can", async () => {
    const { dir, api, agent } = await setup();
    api.queue("front-1", { invalid: ID1 }, { invalid: null });
    await agent.pollOnce();
    expect(await readdir(dir).catch(() => [])).toEqual([]);
    expect(api.reports).toEqual([{ id: ID1, result: { outcome: "failed", error: "error", retry: false } }]);
  });

  it("does not print a second copy when the API offers a ticket again after it was printed", async () => {
    const { dir, api, agent } = await setup();
    api.failReports = true;
    api.queue("front-1", { job: goodJob(ID1) });
    await agent.pollOnce();
    expect(await readdir(dir)).toHaveLength(2);

    // The report never got through, so the API offers the ticket again after its lease: it is reported, not printed again.
    api.failReports = false;
    api.queue("front-1", { job: goodJob(ID1) });
    expect(await agent.pollOnce()).toBe(1);
    expect(await readdir(dir)).toHaveLength(2);
    expect(api.reports).toEqual([{ id: ID1, result: { outcome: "printed" } }]);
  });

  it("carries on when a report cannot be delivered", async () => {
    const { api, agent } = await setup();
    api.failReports = true;
    api.queue("front-1", { job: goodJob(ID1) });
    await expect(agent.pollOnce()).resolves.toBe(1);
  });

  it("tells the API how the printer is, for every kiosk", async () => {
    const { api, printer, agent } = await setup(["front-1", "side-2"]);
    expect(await agent.heartbeatOnce()).toBe("ok");
    printer.failWith = "offline";
    expect(await agent.heartbeatOnce()).toBe("offline");
    expect(api.beats).toEqual([
      { code: "front-1", state: "ok" },
      { code: "side-2", state: "ok" },
      { code: "front-1", state: "offline" },
      { code: "side-2", state: "offline" },
    ]);
    expect(agent.getHealth().printer).toBe("offline");
  });
});
