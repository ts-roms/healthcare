import { inflateSync } from "node:zlib";

/**
 * The text drawn in a PDF this toolkit produced (for tests and checks, not a
 * general PDF parser): content streams are inflated and the hex strings of
 * text operators decoded. Lines are joined with newlines.
 */
export function extractPdfText(pdf: Buffer): string {
  const source = pdf.toString("latin1");
  const lines: string[] = [];
  const stream = /<<([^>]*?)>>\s*stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = stream.exec(source))) {
    const start = match.index + match[0].length;
    const end = source.indexOf("endstream", start);
    if (end < 0) break;
    let raw = pdf.subarray(start, end);
    if (/FlateDecode/.test(match[1] ?? "")) {
      try {
        raw = inflateSync(raw);
      } catch {
        continue;
      }
    }
    const content = raw.toString("latin1");
    for (const op of content.matchAll(/\[([^\]]*)\]\s*TJ|<([0-9a-fA-F]*)>\s*Tj/g)) {
      const hexes = op[1] !== undefined ? [...op[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((m) => m[1] ?? "") : [op[2] ?? ""];
      const text = hexes.map((h) => Buffer.from(h, "hex").toString("latin1")).join("");
      if (text) lines.push(text);
    }
  }
  return lines.join("\n");
}
