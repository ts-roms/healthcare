import { StreamableFile } from "@nestjs/common";

/** A PDF response the browser shows inline (with a file name for saving). */
export function pdfFile(pdf: Buffer, filename: string): StreamableFile {
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, "_");
  return new StreamableFile(pdf, { type: "application/pdf", disposition: `inline; filename="${safe}"`, length: pdf.length });
}
