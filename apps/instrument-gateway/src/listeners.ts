import { createServer, type Server, type Socket } from "node:net";
import { AstmLinkSession, hl7Ack, MllpDecoder, mllpFrame } from "@healthcare/interoperability/instruments";
import type { InstrumentListener } from "./config";
import type { PlatformClient } from "./api-client";

type Log = (event: string, detail: Record<string, unknown>) => void;

/** "20260930101500" in the gateway's local time (the ACK's MSH-7). */
function hl7Timestamp(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

let ackCounter = 0;

/**
 * HL7 v2 over MLLP: each message is posted to the platform, then acknowledged — AA when the platform took it (or already
 * had it), AR when the platform refused it as unreadable or unsupported, AE when it could not be delivered (the analyzer
 * may then resend it).
 */
export function hl7Listener(listener: InstrumentListener, client: PlatformClient, log: Log): Server {
  return createServer((socket: Socket) => {
    const decoder = new MllpDecoder();
    let queue = Promise.resolve();
    socket.on("data", (chunk: Buffer) => {
      for (const message of decoder.push(chunk)) {
        queue = queue.then(async () => {
          const outcome = await client.submit(listener.instrumentId, message);
          const code = outcome.kind === "accepted" ? "AA" : outcome.kind === "refused" ? "AR" : "AE";
          log("hl7.message", {
            instrumentId: listener.instrumentId,
            outcome: outcome.kind,
            ...(outcome.kind === "accepted" ? { duplicate: outcome.duplicate } : {}),
            ...(outcome.kind === "refused" ? { code: outcome.code } : {}),
            ...(outcome.kind === "failed" ? { reason: outcome.reason } : {}),
          });
          ackCounter = (ackCounter + 1) % 1_000_000;
          if (!socket.destroyed) socket.write(mllpFrame(hl7Ack(message, code, `GW${Date.now()}${ackCounter}`, hl7Timestamp())));
        });
      }
    });
    socket.on("error", (error) => log("hl7.socket-error", { instrumentId: listener.instrumentId, message: error.message }));
  });
}

/**
 * ASTM E1381: the link session acknowledges the enquiry and each frame; at the end of a transmission its frames are posted
 * to the platform. The protocol has no application-level reply, so a transmission the platform could not take is retried
 * a few times, then logged for the laboratory to follow up.
 */
export function astmListener(listener: InstrumentListener, client: PlatformClient, log: Log, retryDelaysMs = [5_000, 30_000, 120_000]): Server {
  const deliver = async (transmission: string, attempt = 0): Promise<void> => {
    const outcome = await client.submit(listener.instrumentId, transmission);
    if (outcome.kind === "failed" && attempt < retryDelaysMs.length) {
      log("astm.retry", { instrumentId: listener.instrumentId, reason: outcome.reason, attempt: attempt + 1 });
      await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt]));
      return deliver(transmission, attempt + 1);
    }
    log("astm.transmission", {
      instrumentId: listener.instrumentId,
      outcome: outcome.kind,
      ...(outcome.kind === "refused" ? { code: outcome.code } : {}),
      ...(outcome.kind === "failed" ? { reason: outcome.reason } : {}),
    });
  };
  return createServer((socket: Socket) => {
    const session = new AstmLinkSession();
    socket.on("data", (chunk: Buffer) => {
      const { replies, transmissions } = session.push(chunk);
      if (replies.length && !socket.destroyed) socket.write(Buffer.from(replies));
      for (const transmission of transmissions) void deliver(transmission);
    });
    socket.on("error", (error) => log("astm.socket-error", { instrumentId: listener.instrumentId, message: error.message }));
  });
}
