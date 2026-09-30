import { astmChecksum } from "./instrument-messages";

/**
 * Link layers analyzers use to send results over TCP (docs/domains/laboratory-instruments.md, "Instrument gateway"):
 * HL7 v2 over MLLP (start block VT, end block FS CR — as in the hl7apy library's MLLP server) with an HL7 ACK reply, and
 * ASTM E1381 (ENQ to establish, frames acknowledged with ACK or NAK after the checksum is checked, EOT to end — control
 * characters as in the python-astm library). These are what the on-site instrument gateway runs; the API re-reads every
 * message it receives.
 */

const VT = 0x0b;
const FS = 0x1c;
const CR = 0x0d;
const LF = 0x0a;

export const ASTM = { ENQ: 0x05, ACK: 0x06, NAK: 0x15, EOT: 0x04, STX: 0x02, ETX: 0x03, ETB: 0x17 } as const;

/** Collects bytes from a TCP stream and returns each complete MLLP-framed HL7 message (without its framing). */
export class MllpDecoder {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer): string[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: string[] = [];
    for (;;) {
      const start = this.buffer.indexOf(VT);
      if (start < 0) {
        this.buffer = Buffer.alloc(0);
        break;
      }
      const end = this.buffer.indexOf(Buffer.from([FS, CR]), start + 1);
      if (end < 0) {
        this.buffer = this.buffer.subarray(start);
        break;
      }
      messages.push(this.buffer.subarray(start + 1, end).toString("utf8"));
      this.buffer = this.buffer.subarray(end + 2);
    }
    return messages;
  }
}

export function mllpFrame(text: string): Buffer {
  return Buffer.concat([Buffer.from([VT]), Buffer.from(text, "utf8"), Buffer.from([FS, CR])]);
}

/** HL7 acknowledgment codes (table 0008): accepted, error, rejected. */
export type Hl7AckCode = "AA" | "AE" | "AR";

/**
 * An original-mode acknowledgment of `message`: MSH with the sender and receiver swapped (MSH-3/4 ↔ MSH-5/6), message
 * type ACK with the original trigger event, a new control id, the original processing id and version; MSA-1 the code,
 * MSA-2 the original control id. Delimiters are the original message's.
 */
export function hl7Ack(message: string, code: Hl7AckCode, controlId: string, timestamp: string): string {
  const content = message.replace(/^[\s]+/, "");
  const fieldSep = content.startsWith("MSH") && content.length > 3 ? content[3]! : "|";
  const msh = (content.split(/\r\n|\r|\n/)[0] ?? "").split(fieldSep);
  const encoding = msh[1] && msh[1].length >= 4 ? msh[1] : "^~\\&";
  const componentSep = encoding[0]!;
  // MSH-n is at index n-1.
  const field = (n: number) => (msh[n - 1] ?? "").replaceAll(fieldSep, "");
  const trigger = field(9).split(componentSep)[1] ?? "";
  const header = [
    "MSH",
    encoding,
    field(5),
    field(6),
    field(3),
    field(4),
    timestamp,
    "",
    ["ACK", trigger, "ACK"].join(componentSep),
    controlId,
    field(11) || "P",
    field(12),
  ].join(fieldSep);
  return `${header}\rMSA${fieldSep}${code}${fieldSep}${field(10)}`;
}

/**
 * The receiving side of an ASTM E1381 session. Feed it the bytes the analyzer sends; it returns what to answer (ACK after
 * ENQ and after each frame whose checksum matches, NAK otherwise — the analyzer then resends the frame) and, at EOT, the
 * transmission's accepted frames for the API (which checks the checksums again and joins the records).
 */
export class AstmLinkSession {
  private buffer = Buffer.alloc(0);
  private frames: Buffer[] = [];
  private established = false;

  push(chunk: Buffer): { replies: number[]; transmissions: string[] } {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const replies: number[] = [];
    const transmissions: string[] = [];
    for (;;) {
      if (this.buffer.length === 0) break;
      const byte = this.buffer[0]!;
      if (byte === ASTM.ENQ) {
        this.buffer = this.buffer.subarray(1);
        this.established = true;
        this.frames = [];
        replies.push(ASTM.ACK);
        continue;
      }
      if (byte === ASTM.EOT) {
        this.buffer = this.buffer.subarray(1);
        if (this.established && this.frames.length) transmissions.push(Buffer.concat(this.frames).toString("latin1"));
        this.established = false;
        this.frames = [];
        continue;
      }
      if (byte !== ASTM.STX) {
        // Anything outside a frame (stray CR/LF, noise) is dropped.
        this.buffer = this.buffer.subarray(1);
        continue;
      }
      const end = this.buffer.indexOf(Buffer.from([CR, LF]), 1);
      if (end < 0) break;
      const frame = this.buffer.subarray(0, end + 2);
      this.buffer = this.buffer.subarray(end + 2);
      replies.push(this.established && frameChecksumMatches(frame) ? ASTM.ACK : ASTM.NAK);
      if (this.established && frameChecksumMatches(frame)) this.frames.push(frame);
    }
    return { replies, transmissions };
  }
}

/** STX, frame number … ETX|ETB, two checksum characters, CR LF: the checksum covers the frame number through ETX/ETB. */
function frameChecksumMatches(frame: Buffer): boolean {
  const text = frame.toString("latin1");
  const terminator = Math.max(text.lastIndexOf(String.fromCharCode(ASTM.ETX)), text.lastIndexOf(String.fromCharCode(ASTM.ETB)));
  if (terminator < 2) return false;
  const checksum = text.slice(terminator + 1, terminator + 3);
  return checksum.toUpperCase() === astmChecksum(text.slice(1, terminator + 1));
}
