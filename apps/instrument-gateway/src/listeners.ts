import { createServer, type Server, type Socket } from "node:net";
import { AstmLinkSession, hl7Ack, LinkOverflowError, MllpDecoder, mllpFrame } from "@healthcare/interoperability/instruments";
import { normalizePeer, type InstrumentListener } from "./config";
import type { PlatformClient } from "./api-client";

type Log = (event: string, detail: Record<string, unknown>) => void;

/** "20260930101500" in the gateway's local time (the ACK's MSH-7). */
function hl7Timestamp(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

let ackCounter = 0;

/** One analyzer per listener; a second connection is allowed so a reconnect does not wait for a stale socket to time out. */
export const MAX_CONNECTIONS_PER_LISTENER = 2;

/**
 * Zero trust on the clinic network: only the analyzer's own addresses may connect. Anything else is closed before a byte
 * is read and logged (address only). Returns false when the socket was refused.
 */
function admit(listener: InstrumentListener, socket: Socket, log: Log, protocol: string): boolean {
  const peer = normalizePeer(socket.remoteAddress ?? "");
  if (listener.allowedPeers.includes(peer)) return true;
  log(`${protocol}.peer-refused`, { instrumentId: listener.instrumentId, peer });
  socket.destroy();
  return false;
}

/** A peer that sends more than a message may hold without ending it is cut off (the link layers' limit). */
function overflowed(listener: InstrumentListener, socket: Socket, log: Log, protocol: string, error: unknown): void {
  if (!(error instanceof LinkOverflowError)) throw error;
  log(`${protocol}.overflow`, { instrumentId: listener.instrumentId, limit: error.limit });
  socket.destroy();
}

function limited(server: Server): Server {
  server.maxConnections = MAX_CONNECTIONS_PER_LISTENER;
  return server;
}

/**
 * HL7 v2 over MLLP: each message is posted to the platform, then acknowledged — AA when the platform took it (or already
 * had it), AR when the platform refused it as unreadable or unsupported, AE when it could not be delivered (the analyzer
 * may then resend it).
 */
export function hl7Listener(listener: InstrumentListener, client: PlatformClient, log: Log): Server {
  const server = createServer((socket: Socket) => {
    if (!admit(listener, socket, log, "hl7")) return;
    const decoder = new MllpDecoder();
    let queue = Promise.resolve();
    socket.on("data", (chunk: Buffer) => {
      let messages: string[];
      try {
        messages = decoder.push(chunk);
      } catch (error) {
        overflowed(listener, socket, log, "hl7", error);
        return;
      }
      for (const message of messages) {
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
  return limited(server);
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
  // Deliveries (and their retries) run one after another, so a flood of transmissions cannot start unbounded work.
  let deliveries = Promise.resolve();
  const server = createServer((socket: Socket) => {
    if (!admit(listener, socket, log, "astm")) return;
    const session = new AstmLinkSession();
    socket.on("data", (chunk: Buffer) => {
      let pushed: { replies: number[]; transmissions: string[] };
      try {
        pushed = session.push(chunk);
      } catch (error) {
        overflowed(listener, socket, log, "astm", error);
        return;
      }
      if (pushed.replies.length && !socket.destroyed) socket.write(Buffer.from(pushed.replies));
      for (const transmission of pushed.transmissions)
        deliveries = deliveries
          .then(() => deliver(transmission))
          .catch((error: unknown) => log("astm.delivery-error", { instrumentId: listener.instrumentId, message: String(error) }));
    });
    socket.on("error", (error) => log("astm.socket-error", { instrumentId: listener.instrumentId, message: error.message }));
  });
  return limited(server);
}
