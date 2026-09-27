import PDFDocument from "pdfkit";
import { CODE128_QUIET_ZONE, code128Modules } from "./barcode";
import { winAnsi } from "./pdf";

/**
 * Small adhesive labels (e.g. specimen tube labels): one label per page, sized
 * to the label stock, with a Code 128 barcode and a few lines of text. Text
 * that does not fit is cut with an ellipsis rather than wrapped off the label.
 */

export interface LabelLine {
  text: string;
  bold?: boolean;
  /** Points; default 6.5. */
  size?: number;
  /** Lines the text may wrap to; default 1. */
  maxLines?: number;
}

export interface LabelSpec {
  /** Lines above the barcode. */
  top: LabelLine[];
  /** Encoded as Code 128 and printed in human-readable form under the bars. */
  barcode: string;
  /** Lines below the barcode text. */
  bottom: LabelLine[];
}

export interface LabelStock {
  /** Points (1/72 in). */
  width: number;
  height: number;
}

/** 2.25 × 1.25 in (57 × 32 mm), a common specimen label for thermal printers. */
export const SPECIMEN_LABEL_STOCK: LabelStock = { width: 162, height: 90 };

const MARGIN = 5;
const BAR_HEIGHT = 26;
/** Widest module worth drawing (thicker bars only waste label width). */
const MAX_MODULE = 1.5;

type Doc = InstanceType<typeof PDFDocument>;

/** Renders labels, one per page. */
export function renderLabels(stock: LabelStock, labels: LabelSpec[], options: { title: string; uncompressed?: boolean }): Promise<Buffer> {
  if (labels.length === 0) throw new Error("No labels to print");
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
  for (const label of labels) {
    doc.addPage({ size: [stock.width, stock.height], margin: 0 });
    drawLabel(doc, stock, label);
  }
  doc.end();
  return done;
}

function drawLabel(doc: Doc, stock: LabelStock, label: LabelSpec): void {
  const width = stock.width - MARGIN * 2;
  let y = MARGIN - 1;
  for (const line of label.top) y = text(doc, line, y, width);

  const modules = code128Modules(label.barcode);
  const total = modules.length + CODE128_QUIET_ZONE * 2;
  const module = Math.min(stock.width / total, MAX_MODULE);
  let x = (stock.width - modules.length * module) / 2;
  y += 1.5;
  doc.fillColor("black");
  // Adjacent bar modules are drawn as one rectangle so no hairline gaps appear between them.
  for (let i = 0; i < modules.length;) {
    if (!modules[i]) {
      i++;
      x += module;
      continue;
    }
    let run = 0;
    while (modules[i + run]) run++;
    doc.rect(x, y, run * module, BAR_HEIGHT).fill();
    x += run * module;
    i += run;
  }
  y += BAR_HEIGHT + 1;
  doc.font("Helvetica-Bold").fontSize(7.5).text(winAnsi(label.barcode), MARGIN, y, { width, align: "center", lineBreak: false, characterSpacing: 1 });
  y += 9;
  for (const line of label.bottom) y = text(doc, line, y, width);
}

function text(doc: Doc, line: LabelLine, y: number, width: number): number {
  doc
    .font(line.bold ? "Helvetica-Bold" : "Helvetica")
    .fontSize(line.size ?? 6.5)
    .fillColor("black");
  const height = doc.currentLineHeight(true) * (line.maxLines ?? 1);
  // pdfkit stops before a line that would cross the box, so allow half a point of slack for rounding.
  doc.text(winAnsi(line.text), MARGIN, y, { width, height: height + 0.5, ellipsis: true, lineGap: 0 });
  return y + height;
}
