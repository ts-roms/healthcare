import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { winAnsi } from "./pdf";

/**
 * A patient card: one ID-1 card (85.6 × 54 mm, the size of a bank card; also fits a wristband printer's label when
 * the stock is changed) per page, with a QR code on the left and a few lines of text on the right.
 */

export interface QrCardLine {
  text: string;
  bold?: boolean;
  /** Points; default 8. */
  size?: number;
  /** Lines the text may wrap to; default 1. */
  maxLines?: number;
}

export interface QrCardSpec {
  /** Encoded as the QR code (error correction M). */
  qr: string;
  /** The facility or organization, small, above the lines. */
  heading: string;
  lines: QrCardLine[];
  /** A short instruction at the bottom of the text column. */
  footer?: string;
}

export interface QrCardStock {
  width: number;
  height: number;
}

/** 3.375 × 2.125 in. */
export const CARD_STOCK: QrCardStock = { width: 243, height: 153 };

const MARGIN = 10;
/** Quiet zone around the symbol, in modules (the QR standard asks for four). */
const QUIET = 4;

type Doc = InstanceType<typeof PDFDocument>;

/** The dark modules of a QR symbol as rows of booleans (square, no quiet zone). Exported for tests. */
export function qrMatrix(text: string): boolean[][] {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
  const rows: boolean[][] = [];
  for (let r = 0; r < modules.size; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < modules.size; c++) row.push(modules.get(r, c) === 1);
    rows.push(row);
  }
  return rows;
}

/** Renders cards, one per page. */
export function renderQrCards(stock: QrCardStock, cards: QrCardSpec[], options: { title: string; uncompressed?: boolean }): Promise<Buffer> {
  if (cards.length === 0) throw new Error("No cards to print");
  const doc = new PDFDocument({
    size: [stock.width, stock.height],
    margin: 0,
    autoFirstPage: false,
    compress: !options.uncompressed,
    info: { Title: winAnsi(options.title), Creator: "Healthcare Platform" },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  for (const card of cards) {
    doc.addPage({ size: [stock.width, stock.height], margin: 0 });
    drawCard(doc, stock, card);
  }
  doc.end();
  return done;
}

function drawCard(doc: Doc, stock: QrCardStock, card: QrCardSpec): void {
  const matrix = qrMatrix(card.qr);
  const side = Math.min(stock.height - MARGIN * 2, 104);
  const module = side / (matrix.length + QUIET * 2);
  const left = MARGIN;
  const top = (stock.height - side) / 2;
  doc.fillColor("black");
  for (let r = 0; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    for (let c = 0; c < row.length;) {
      if (!row[c]) {
        c++;
        continue;
      }
      let run = 0;
      while (row[c + run]) run++;
      // Runs are drawn as one rectangle so no hairline gaps appear between adjacent modules.
      doc.rect(left + (c + QUIET) * module, top + (r + QUIET) * module, run * module, module).fill();
      c += run;
    }
  }
  const x = left + side + 8;
  const width = stock.width - x - MARGIN;
  let y = MARGIN;
  y = text(doc, { text: card.heading, size: 6.5 }, x, y, width) + 3;
  for (const line of card.lines) y = text(doc, { size: 8, ...line }, x, y, width) + 1.5;
  if (card.footer) text(doc, { text: card.footer, size: 6 }, x, stock.height - MARGIN - 18, width, 2);
}

function text(doc: Doc, line: QrCardLine, x: number, y: number, width: number, maxLines = line.maxLines ?? 1): number {
  doc
    .font(line.bold ? "Helvetica-Bold" : "Helvetica")
    .fontSize(line.size ?? 8)
    .fillColor("black");
  const height = doc.currentLineHeight(true) * maxLines;
  doc.text(winAnsi(line.text), x, y, { width, height: height + 0.5, ellipsis: true, lineGap: 0 });
  return y + height;
}
