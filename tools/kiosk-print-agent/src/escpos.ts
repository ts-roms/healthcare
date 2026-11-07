/**
 * ESC/POS for kiosk queue tickets (80 mm and 58 mm thermal printers).
 *
 * A ticket is built from a fixed template: the only variable parts are plain text fields from the API (the facility's name,
 * the service, the time, an instruction) and the ticket number. Every text field is reduced to printable ASCII before it
 * is placed in the byte stream, so nothing a field contains can be read by the printer as a command (ESC, GS, DLE and the
 * other control bytes never come from text).
 */
export type PaperWidth = 58 | 80;

/** Characters per line in the printer's standard font. */
export const COLUMNS: Record<PaperWidth, number> = { 80: 48, 58: 32 };

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

const INIT = Buffer.from([ESC, 0x40]);
const ALIGN_CENTER = Buffer.from([ESC, 0x61, 0x01]);
const ALIGN_LEFT = Buffer.from([ESC, 0x61, 0x00]);
const BOLD_ON = Buffer.from([ESC, 0x45, 0x01]);
const BOLD_OFF = Buffer.from([ESC, 0x45, 0x00]);
/** Character size: width x4, height x4 (GS ! 0x33) and back to normal. */
const SIZE_BIG = Buffer.from([GS, 0x21, 0x33]);
const SIZE_NORMAL = Buffer.from([GS, 0x21, 0x00]);
/** Feed then partial cut (GS V 66 n). */
const cut = (feed: number) => Buffer.from([GS, 0x56, 0x42, feed]);

const REPLACEMENTS: Array<[RegExp, string]> = [
  [/[‘’‛]/g, "'"],
  [/[“”‟]/g, '"'],
  [/[–—−]/g, "-"],
  [/…/g, "..."],
  [/\u00A0/g, " "],
];

/**
 * Printable ASCII only: accents are dropped (the printer's code page is not known), typographic quotes and dashes become
 * plain ones, and everything else — control characters, escape sequences' bytes, emoji — is removed or becomes "?".
 */
export function toPrintable(text: string): string {
  let out = text;
  for (const [pattern, replacement] of REPLACEMENTS) out = out.replace(pattern, replacement);
  out = out.normalize("NFD").replace(/[̀-ͯ]/g, "");
  // eslint-disable-next-line no-control-regex
  out = out.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
  // One "?" per character (a code point), not per UTF-16 unit: an emoji is one.
  out = out.replace(/[^\x20-\x7e]/gu, "?");
  return out.replace(/\s+/g, " ").trim();
}

/** Breaks text into lines of at most `columns` characters at spaces (a word longer than a line is cut). */
export function wrap(text: string, columns: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ").filter(Boolean)) {
    let rest = word;
    while (rest.length > columns) {
      if (line) {
        lines.push(line);
        line = "";
      }
      lines.push(rest.slice(0, columns));
      rest = rest.slice(columns);
    }
    if (!line) line = rest;
    else if (line.length + 1 + rest.length <= columns) line = `${line} ${rest}`;
    else {
      lines.push(line);
      line = rest;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export interface TicketToPrint {
  ticket: string;
  serviceName: string;
  facilityName: string;
  issuedAt: Date;
  instructions: string;
}

export interface RenderOptions {
  width: PaperWidth;
  /** The facility's time zone, for the time on the ticket (default Asia/Manila). */
  timeZone?: string;
}

const text = (value: string) => Buffer.from(`${value}\n`, "ascii");
const rule = (columns: number) => text("-".repeat(columns));

function when(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-PH", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone }).format(date);
}

/** The bytes of one ticket. The same input always gives the same bytes. */
export function renderTicket(job: TicketToPrint, { width, timeZone = "Asia/Manila" }: RenderOptions): Buffer {
  const columns = COLUMNS[width];
  // The big ticket number is four times as wide: it must fit in a quarter of the line.
  const number = toPrintable(job.ticket).slice(0, Math.floor(columns / 4));
  const parts: Buffer[] = [INIT, ALIGN_CENTER, BOLD_ON];
  for (const line of wrap(toPrintable(job.facilityName), columns)) parts.push(text(line));
  parts.push(BOLD_OFF, rule(columns), text("Your number"), SIZE_BIG, BOLD_ON, text(number), BOLD_OFF, SIZE_NORMAL);
  for (const line of wrap(toPrintable(job.serviceName), columns)) parts.push(text(line));
  parts.push(text(toPrintable(when(job.issuedAt, timeZone))), rule(columns));
  for (const line of wrap(toPrintable(job.instructions), columns)) parts.push(text(line));
  parts.push(ALIGN_LEFT, Buffer.from([LF, LF, LF]), cut(3));
  return Buffer.concat(parts);
}

/** A readable copy of what a ticket says, for the dry-run printer and for tests (no control bytes). */
export function previewTicket(job: TicketToPrint, options: RenderOptions): string {
  const columns = COLUMNS[options.width];
  const timeZone = options.timeZone ?? "Asia/Manila";
  return [
    ...wrap(toPrintable(job.facilityName), columns),
    "-".repeat(columns),
    "Your number",
    toPrintable(job.ticket),
    ...wrap(toPrintable(job.serviceName), columns),
    toPrintable(when(job.issuedAt, timeZone)),
    "-".repeat(columns),
    ...wrap(toPrintable(job.instructions), columns),
  ].join("\n");
}

/** The text of a ticket's bytes with its printer commands removed: what a dry run keeps beside the raw bytes. */
export function previewBytes(data: Buffer): string {
  const out: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const byte = data[i] as number;
    if (byte === ESC) {
      // ESC @ (1 byte after), ESC a n / ESC E n (2 after)
      i += data[i + 1] === 0x40 ? 1 : 2;
    } else if (byte === GS) {
      // GS ! n (2 after), GS V m n (3 after)
      i += data[i + 1] === 0x56 ? 3 : 2;
    } else if (byte === LF || (byte >= 0x20 && byte <= 0x7e)) {
      out.push(byte);
    }
  }
  return Buffer.from(out).toString("ascii");
}
