import { appendFile, access, constants, mkdir, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { join } from "node:path";
import { type AgentConfig } from "./config";

/** What a printer reports; the same words the API uses for a kiosk's printer. */
export type PrinterState = "ok" | "paper_out" | "offline" | "error";

/** A printing problem with a short cause the API understands; never the printer's raw answer. */
export class PrinterError extends Error {
  constructor(
    readonly code: Exclude<PrinterState, "ok">,
    message: string,
  ) {
    super(message);
    this.name = "PrinterError";
  }
}

export interface Printer {
  /** Sends the bytes of one ticket; throws `PrinterError` when it cannot. */
  send(data: Buffer): Promise<void>;
  /** The printer's state as far as it can be known. */
  status(): Promise<PrinterState>;
}

const CONNECT_TIMEOUT_MS = 5_000;
const STATUS_TIMEOUT_MS = 1_500;
/** DLE EOT 4: ask for the paper roll sensor status (real-time status transmission). */
const ASK_PAPER_STATUS = Buffer.from([0x10, 0x04, 0x04]);

/**
 * A network thermal printer (raw port, normally 9100). Status asks the printer for its paper sensor and reads one byte; a
 * printer that does not answer is treated as working (it accepted the connection), because not every model replies.
 */
export class TcpPrinter implements Printer {
  constructor(
    private readonly host: string,
    private readonly port: number,
  ) {}

  async send(data: Buffer): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const socket = connect({ host: this.host, port: this.port });
      socket.setTimeout(CONNECT_TIMEOUT_MS);
      socket.once("timeout", () => {
        socket.destroy();
        reject(new PrinterError("offline", "The printer did not answer"));
      });
      socket.once("error", () => reject(new PrinterError("offline", "The printer could not be reached")));
      socket.once("connect", () => {
        socket.write(data, (error) => {
          if (error) return reject(new PrinterError("error", "The ticket could not be sent"));
          socket.end();
        });
      });
      socket.once("close", (hadError) => {
        if (!hadError) resolve();
      });
    });
  }

  async status(): Promise<PrinterState> {
    return new Promise<PrinterState>((resolve) => {
      const socket = connect({ host: this.host, port: this.port });
      let answered = false;
      const done = (state: PrinterState) => {
        if (answered) return;
        answered = true;
        socket.destroy();
        resolve(state);
      };
      socket.setTimeout(CONNECT_TIMEOUT_MS);
      socket.once("timeout", () => done("offline"));
      socket.once("error", () => done("offline"));
      socket.once("connect", () => {
        socket.write(ASK_PAPER_STATUS);
        // No answer within a moment: reachable, status not supported.
        setTimeout(() => done("ok"), STATUS_TIMEOUT_MS).unref();
      });
      socket.once("data", (byte) => {
        // Bits 5 and 6 of the paper sensor byte: roll paper end.
        const first = byte[0] ?? 0;
        done((first & 0x60) !== 0 ? "paper_out" : "ok");
      });
    });
  }
}

/**
 * A printer reached through the operating system: a device file (/dev/usb/lp0) or a shared raw queue (\\localhost\TicketPrinter
 * on Windows). The bytes are appended as they are; the operating system's own queue decides the rest.
 */
export class FilePrinter implements Printer {
  constructor(private readonly path: string) {}

  async send(data: Buffer): Promise<void> {
    try {
      await appendFile(this.path, data);
    } catch {
      throw new PrinterError("offline", "The printer could not be written to");
    }
  }

  async status(): Promise<PrinterState> {
    try {
      await access(this.path, constants.W_OK);
      return "ok";
    } catch {
      return "offline";
    }
  }
}

/** Writes each ticket to a folder as raw bytes and a readable text, instead of printing: for set-up and tests without a printer. */
export class DryRunPrinter implements Printer {
  private count = 0;
  /** A test or a rehearsal can make the next sends fail with this state. */
  failWith: Exclude<PrinterState, "ok"> | null = null;

  constructor(
    private readonly dir: string,
    private readonly preview: (data: Buffer) => string = () => "",
  ) {}

  async send(data: Buffer): Promise<void> {
    if (this.failWith) throw new PrinterError(this.failWith, "Simulated printer problem");
    await mkdir(this.dir, { recursive: true });
    this.count += 1;
    const name = join(this.dir, `ticket-${String(this.count).padStart(4, "0")}`);
    await writeFile(`${name}.bin`, data);
    const text = this.preview(data);
    if (text) await writeFile(`${name}.txt`, text);
  }

  async status(): Promise<PrinterState> {
    return this.failWith ?? "ok";
  }
}

export function createPrinter(config: AgentConfig["printer"], preview?: (data: Buffer) => string): Printer {
  switch (config.type) {
    case "tcp":
      return new TcpPrinter(config.host, config.port);
    case "file":
      return new FilePrinter(config.path);
    case "dryrun":
      return new DryRunPrinter(config.dir, preview);
  }
}
