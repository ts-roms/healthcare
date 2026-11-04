import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentHealth } from "./agent";
import { HEALTH_HOST, startHealthServer } from "./health";
import { DryRunPrinter, FilePrinter, PrinterError, TcpPrinter } from "./printer";

const listen = (server: Server) => new Promise<number>((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));

describe("DryRunPrinter", () => {
  it("keeps each ticket as raw bytes and readable text, and can be made to fail", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dry-"));
    const printer = new DryRunPrinter(dir, (b) => `bytes:${b.length}`);
    await printer.send(Buffer.from("abc"));
    await printer.send(Buffer.from("de"));
    expect((await readdir(dir)).sort()).toEqual(["ticket-0001.bin", "ticket-0001.txt", "ticket-0002.bin", "ticket-0002.txt"]);
    expect(await readFile(join(dir, "ticket-0002.txt"), "utf8")).toBe("bytes:2");
    printer.failWith = "offline";
    await expect(printer.send(Buffer.from("x"))).rejects.toMatchObject({ code: "offline" });
    expect(await printer.status()).toBe("offline");
  });
});

describe("FilePrinter", () => {
  it("appends the bytes, and reports a path it cannot write as offline", async () => {
    const dir = await mkdtemp(join(tmpdir(), "file-"));
    const path = join(dir, "lp0");
    const printer = new FilePrinter(path);
    expect(await printer.status()).toBe("offline");
    await printer.send(Buffer.from("one"));
    await printer.send(Buffer.from("two"));
    expect((await readFile(path)).toString()).toBe("onetwo");
    expect(await printer.status()).toBe("ok");
    await expect(new FilePrinter(join(dir, "missing", "lp0")).send(Buffer.from("x"))).rejects.toBeInstanceOf(PrinterError);
  });
});

describe("TcpPrinter", () => {
  it("sends the bytes to the printer and fails as offline when nothing is listening", async () => {
    const received: Buffer[] = [];
    const server = createServer((socket) => socket.on("data", (d) => received.push(d)));
    const port = await listen(server);
    await new TcpPrinter("127.0.0.1", port).send(Buffer.from("TICKET"));
    await close(server);
    expect(Buffer.concat(received).toString()).toBe("TICKET");
    await expect(new TcpPrinter("127.0.0.1", port).send(Buffer.from("x"))).rejects.toMatchObject({ code: "offline" });
    expect(await new TcpPrinter("127.0.0.1", port).status()).toBe("offline");
  });

  it("reads the paper sensor when the printer answers, and calls a silent one working", async () => {
    const answering = (byte: number) =>
      createServer((socket) =>
        socket.on("data", (d) => {
          if (d.equals(Buffer.from([0x10, 0x04, 0x04]))) socket.write(Buffer.from([byte]));
        }),
      );
    for (const [byte, expected] of [
      [0x12, "ok"],
      [0x72, "paper_out"],
    ] as const) {
      const server = answering(byte);
      const port = await listen(server);
      expect(await new TcpPrinter("127.0.0.1", port).status()).toBe(expected);
      await close(server);
    }
  }, 15_000);
});

describe("the health server", () => {
  const health = (over: Partial<AgentHealth> = {}): AgentHealth => ({
    status: "ok",
    lastPollAt: "2026-11-04T01:30:00.000Z",
    lastPrintAt: null,
    lastError: null,
    printer: "ok",
    printedSinceStart: 3,
    ...over,
  });

  it("listens on this machine only, answers GET /health, and nothing else", async () => {
    const server = await startHealthServer(0, () => health());
    const address = server.address() as AddressInfo;
    expect(address.address).toBe(HEALTH_HOST);
    expect(HEALTH_HOST).toBe("127.0.0.1");
    const base = `http://127.0.0.1:${address.port}`;

    const ok = await fetch(`${base}/health`);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ status: "ok", printedSinceStart: 3 });
    // No way in for a job, or for anything else.
    expect((await fetch(`${base}/health`, { method: "POST", body: "{}" })).status).toBe(405);
    expect((await fetch(`${base}/jobs`, { method: "POST", body: "{}" })).status).toBe(404);
    expect((await fetch(`${base}/`)).status).toBe(404);
    await new Promise((resolve) => server.close(resolve));
  });

  it("answers 503 while the printer has a problem", async () => {
    let current = health({ printer: "paper_out" });
    const server = await startHealthServer(0, () => current);
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/health`;
    expect((await fetch(url)).status).toBe(503);
    current = health({ status: "degraded" });
    expect((await fetch(url)).status).toBe(503);
    current = health();
    expect((await fetch(url)).status).toBe(200);
    await new Promise((resolve) => server.close(resolve));
  });
});
