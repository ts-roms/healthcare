import PDFDocument from "pdfkit";

/**
 * A small, dependency-light toolkit for the platform's printable documents
 * (laboratory reports, invoices, receipts): A4, the facility's letterhead, a
 * title, key/value blocks, tables that break across pages with their header
 * repeated, an optional watermark (DRAFT, VOID) and a footer with page numbers.
 *
 * Uses the PDF standard fonts (Helvetica), so no font files are shipped; text
 * is reduced to the fonts' WinAnsi character set (Filipino names with ñ are
 * fine; the peso sign is written "PHP").
 */

export interface Letterhead {
  organizationName: string;
  facilityName?: string | null;
  addressLines?: string[];
  contact?: string | null;
  licenseNumber?: string | null;
}

export interface PdfSpec {
  title: string;
  subtitle?: string;
  letterhead: Letterhead;
  /** Large diagonal text on every page, e.g. "DRAFT" or "VOID". */
  watermark?: string;
  /** Printed at the bottom of every page (e.g. what the document is not). */
  footerNote?: string;
  /** "Printed 28 Sep 2026, 14:05 (Asia/Manila)". */
  printedAt: string;
  /** PDF metadata. */
  author?: string;
  /** Plain (uncompressed) content streams; for tests. */
  uncompressed?: boolean;
}

export interface Column {
  header: string;
  /** Share of the content width. */
  width: number;
  align?: "left" | "right" | "center";
}

const MARGIN = 48;
const FOOTER_HEIGHT = 36;
const MUTED = "#555555";
const RULE = "#bbbbbb";

type Doc = InstanceType<typeof PDFDocument>;

/** Writes the body of a document; created by `renderPdf`. */
export class PdfWriter {
  constructor(private readonly doc: Doc) {}

  private get width(): number {
    return this.doc.page.width - MARGIN * 2;
  }

  private get bottom(): number {
    return this.doc.page.height - MARGIN - FOOTER_HEIGHT;
  }

  private ensure(height: number): void {
    if (this.doc.y + height > this.bottom) this.doc.addPage();
  }

  heading(text: string): this {
    this.ensure(28);
    this.doc.moveDown(0.6).font("Helvetica-Bold").fontSize(11).fillColor("black").text(winAnsi(text), MARGIN, this.doc.y);
    this.doc.moveDown(0.3);
    return this;
  }

  paragraph(text: string, options: { muted?: boolean; size?: number; bold?: boolean } = {}): this {
    this.ensure(16);
    this.doc
      .font(options.bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(options.size ?? 9.5)
      .fillColor(options.muted ? MUTED : "black")
      .text(winAnsi(text), MARGIN, this.doc.y, { width: this.width });
    this.doc.fillColor("black");
    return this;
  }

  /** Label/value pairs laid out in columns (e.g. patient and order details). */
  fields(rows: Array<[string, string | null | undefined]>, columns = 2): this {
    const visible = rows.filter((r): r is [string, string] => Boolean(r[1]));
    const colWidth = this.width / columns;
    for (let i = 0; i < visible.length; i += columns) {
      const line = visible.slice(i, i + columns);
      const heights = line.map(([, value]) => {
        this.doc.fontSize(9.5);
        return this.doc.heightOfString(winAnsi(value), { width: colWidth - 8 }) + 12;
      });
      const height = Math.max(...heights);
      this.ensure(height);
      const y = this.doc.y;
      line.forEach(([label, value], c) => {
        const x = MARGIN + c * colWidth;
        this.doc
          .font("Helvetica")
          .fontSize(7.5)
          .fillColor(MUTED)
          .text(winAnsi(label.toUpperCase()), x, y, { width: colWidth - 8 });
        this.doc
          .font("Helvetica")
          .fontSize(9.5)
          .fillColor("black")
          .text(winAnsi(value), x, y + 10, { width: colWidth - 8 });
      });
      this.doc.y = y + height;
    }
    this.doc.x = MARGIN;
    return this;
  }

  /** A table; rows break across pages with the header repeated. `emphasis` rows are bold. */
  table(columns: Column[], rows: string[][], options: { emphasis?: number[]; fontSize?: number } = {}): this {
    const total = columns.reduce((a, c) => a + c.width, 0);
    const widths = columns.map((c) => (c.width / total) * this.width);
    const size = options.fontSize ?? 9;
    const pad = 4;
    const drawHeader = () => {
      this.doc.font("Helvetica-Bold").fontSize(7.5);
      // Headers may wrap (e.g. "Reference range"): the row is as tall as the tallest.
      const height =
        Math.max(...columns.map((c, i) => this.doc.heightOfString(winAnsi(c.header.toUpperCase()), { width: (widths[i] ?? 0) - pad * 2 }))) + pad * 2;
      this.ensure(height + 4);
      const y = this.doc.y;
      let x = MARGIN;
      this.doc.fillColor(MUTED);
      columns.forEach((c, i) => {
        this.doc.text(winAnsi(c.header.toUpperCase()), x + pad, y + pad, { width: (widths[i] ?? 0) - pad * 2, align: c.align ?? "left" });
        x += widths[i] ?? 0;
      });
      this.doc.y = y + height;
      this.rule(RULE);
      this.doc.fillColor("black");
    };
    drawHeader();
    rows.forEach((row, r) => {
      const bold = options.emphasis?.includes(r);
      this.doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size);
      const height = Math.max(...row.map((cell, i) => this.doc.heightOfString(winAnsi(cell), { width: (widths[i] ?? 0) - pad * 2 }))) + pad * 2;
      if (this.doc.y + height > this.bottom) {
        this.doc.addPage();
        drawHeader();
        this.doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size);
      }
      const y = this.doc.y;
      let x = MARGIN;
      row.forEach((cell, i) => {
        this.doc.text(winAnsi(cell), x + pad, y + pad, { width: (widths[i] ?? 0) - pad * 2, align: columns[i]?.align ?? "left" });
        x += widths[i] ?? 0;
      });
      this.doc.y = y + height;
      this.rule("#e5e5e5");
    });
    this.doc.x = MARGIN;
    this.doc.moveDown(0.3);
    return this;
  }

  /** Right-aligned label/amount lines (invoice totals). */
  totals(rows: Array<[string, string, boolean?]>): this {
    const labelWidth = this.width * 0.35;
    const valueWidth = this.width * 0.2;
    const x = MARGIN + this.width - labelWidth - valueWidth;
    for (const [label, value, strong] of rows) {
      this.ensure(14);
      const y = this.doc.y;
      this.doc.font(strong ? "Helvetica-Bold" : "Helvetica").fontSize(strong ? 10 : 9.5);
      this.doc.text(winAnsi(label), x, y, { width: labelWidth });
      this.doc.text(winAnsi(value), x + labelWidth, y, { width: valueWidth, align: "right" });
      this.doc.y = y + (strong ? 15 : 13);
    }
    this.doc.x = MARGIN;
    return this;
  }

  /** Signature lines, side by side. */
  signatures(people: Array<{ name: string; role: string }>): this {
    if (people.length === 0) return this;
    this.ensure(60);
    this.doc.moveDown(2);
    const colWidth = this.width / Math.max(people.length, 2);
    const y = this.doc.y;
    people.forEach((p, i) => {
      const x = MARGIN + i * colWidth;
      this.doc
        .moveTo(x, y)
        .lineTo(x + colWidth - 24, y)
        .strokeColor(RULE)
        .stroke();
      this.doc
        .font("Helvetica-Bold")
        .fontSize(9)
        .fillColor("black")
        .text(winAnsi(p.name), x, y + 4, { width: colWidth - 24 });
      this.doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor(MUTED)
        .text(winAnsi(p.role), x, y + 16, { width: colWidth - 24 });
    });
    this.doc.fillColor("black");
    this.doc.y = y + 34;
    this.doc.x = MARGIN;
    return this;
  }

  space(lines = 0.6): this {
    this.doc.moveDown(lines);
    return this;
  }

  private rule(color: string): void {
    this.doc
      .moveTo(MARGIN, this.doc.y)
      .lineTo(MARGIN + this.width, this.doc.y)
      .lineWidth(0.5)
      .strokeColor(color)
      .stroke();
  }
}

/** Renders a document to a PDF buffer. */
export function renderPdf(spec: PdfSpec, body: (w: PdfWriter) => void): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    bufferPages: true,
    compress: !spec.uncompressed,
    info: { Title: winAnsi(spec.title), Author: winAnsi(spec.author ?? spec.letterhead.organizationName), Creator: "Healthcare Platform" },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  letterhead(doc, spec);
  body(new PdfWriter(doc));

  // Footer and watermark on every page, once the page count is known.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const width = doc.page.width - MARGIN * 2;
    const y = doc.page.height - MARGIN - FOOTER_HEIGHT + 8;
    // Writing in the bottom margin must not start a new page.
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    if (spec.watermark) {
      doc.save();
      doc.rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] });
      doc
        .font("Helvetica-Bold")
        .fontSize(96)
        .fillColor("#cc0000")
        .opacity(0.12)
        .text(winAnsi(spec.watermark), 0, doc.page.height / 2 - 48, { width: doc.page.width, align: "center", lineBreak: false });
      doc.restore();
      doc.opacity(1);
    }
    doc
      .moveTo(MARGIN, y - 6)
      .lineTo(MARGIN + width, y - 6)
      .lineWidth(0.5)
      .strokeColor(RULE)
      .stroke();
    doc.font("Helvetica").fontSize(7.5).fillColor(MUTED);
    if (spec.footerNote) doc.text(winAnsi(spec.footerNote), MARGIN, y, { width: width * 0.75, lineBreak: true });
    doc.text(winAnsi(`${spec.printedAt} · Page ${i - range.start + 1} of ${range.count}`), MARGIN + width * 0.5, y + (spec.footerNote ? 18 : 0), {
      width: width * 0.5,
      align: "right",
      lineBreak: false,
    });
    doc.page.margins.bottom = bottomMargin;
  }
  doc.end();
  return done;
}

function letterhead(doc: Doc, spec: PdfSpec): void {
  const width = doc.page.width - MARGIN * 2;
  const h = spec.letterhead;
  doc.font("Helvetica-Bold").fontSize(14).fillColor("black").text(winAnsi(h.organizationName), MARGIN, MARGIN, { width });
  doc.font("Helvetica").fontSize(8.5).fillColor(MUTED);
  const lines = [h.facilityName, ...(h.addressLines ?? []), h.contact, h.licenseNumber ? `License no. ${h.licenseNumber}` : null].filter((l): l is string =>
    Boolean(l),
  );
  for (const line of lines) doc.text(winAnsi(line), { width });
  doc.moveDown(0.6);
  doc
    .moveTo(MARGIN, doc.y)
    .lineTo(MARGIN + width, doc.y)
    .lineWidth(1)
    .strokeColor("black")
    .stroke();
  doc.moveDown(0.6);
  doc.font("Helvetica-Bold").fontSize(15).fillColor("black").text(winAnsi(spec.title), MARGIN, doc.y, { width });
  if (spec.subtitle) doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(winAnsi(spec.subtitle), { width });
  doc.fillColor("black");
  doc.moveDown(0.6);
}

// WinAnsi (cp1252) extras beyond Latin-1 that the standard fonts can draw.
const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
const REPLACEMENTS: Record<string, string> = { "₱": "PHP ", "−": "-", "≥": ">=", "≤": "<=", "→": "->", "✓": "v", " ": " " };

/** Reduces text to what the standard PDF fonts can draw. */
export function winAnsi(text: string): string {
  let out = "";
  for (const ch of text.normalize("NFC")) {
    const code = ch.codePointAt(0) ?? 0;
    if (REPLACEMENTS[ch] !== undefined) out += REPLACEMENTS[ch];
    else if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || ch === "\n" || WIN_ANSI_EXTRA.has(ch)) out += ch;
    else out += "?";
  }
  return out;
}

/** "PHP 1,234.50" from integer centavos (the standard fonts have no peso sign). */
export function pdfMoney(centavos: number): string {
  const sign = centavos < 0 ? "-" : "";
  const abs = Math.abs(centavos);
  return `${sign}PHP ${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function zonedParts(at: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return { y: parts["year"], m: MONTHS[Number(parts["month"]) - 1], d: parts["day"], time: `${parts["hour"]}:${parts["minute"]}` };
}

/** "28 Sep 2026, 14:05" in a time zone. */
export function pdfDateTime(at: Date, timeZone: string): string {
  const z = zonedParts(at, timeZone);
  return `${z.d} ${z.m} ${z.y}, ${z.time}`;
}

/** "28 Sep 2026" for a calendar date (YYYY-MM-DD) or an instant in a time zone. */
export function pdfDate(value: string | Date, timeZone = "UTC"): string {
  const z = typeof value === "string" ? zonedParts(new Date(`${value.slice(0, 10)}T12:00:00Z`), "UTC") : zonedParts(value, timeZone);
  return `${z.d} ${z.m} ${z.y}`;
}

/** A facility's letterhead from organization and facility records. */
export function facilityLetterhead(
  organizationName: string,
  facility: {
    name: string;
    addressLine: string | null;
    barangay: string | null;
    cityMunicipality: string | null;
    province: string | null;
    postalCode?: string | null;
    contactNumber: string | null;
    email?: string | null;
    licenseNumber: string | null;
  },
): Letterhead {
  const street = [facility.addressLine, facility.barangay].filter(Boolean).join(", ");
  const city = [facility.cityMunicipality, facility.province, facility.postalCode].filter(Boolean).join(", ");
  return {
    organizationName,
    facilityName: facility.name,
    addressLines: [street, city].filter(Boolean),
    contact: [facility.contactNumber, facility.email].filter(Boolean).join(" · ") || null,
    licenseNumber: facility.licenseNumber,
  };
}
