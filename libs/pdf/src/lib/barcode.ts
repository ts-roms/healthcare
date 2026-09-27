/**
 * Code 128 (ISO/IEC 15417) — the linear symbology every handheld laboratory
 * scanner reads. Accession numbers are digits, so they use code set C (two
 * digits per symbol) for a short barcode that fits a tube label; anything
 * else uses code set B (printable ASCII).
 */

// Symbol patterns by value (0–106): module widths as 1 = bar, 0 = space; 103–105 are Start A/B/C, 106 is Stop.
// prettier-ignore
const PATTERNS = [
  "11011001100", "11001101100", "11001100110", "10010011000", "10010001100", "10001001100", "10011001000", "10011000100",
  "10001100100", "11001001000", "11001000100", "11000100100", "10110011100", "10011011100", "10011001110", "10111001100",
  "10011101100", "10011100110", "11001110010", "11001011100", "11001001110", "11011100100", "11001110100", "11101101110",
  "11101001100", "11100101100", "11100100110", "11101100100", "11100110100", "11100110010", "11011011000", "11011000110",
  "11000110110", "10100011000", "10001011000", "10001000110", "10110001000", "10001101000", "10001100010", "11010001000",
  "11000101000", "11000100010", "10110111000", "10110001110", "10001101110", "10111011000", "10111000110", "10001110110",
  "11101110110", "11010001110", "11000101110", "11011101000", "11011100010", "11011101110", "11101011000", "11101000110",
  "11100010110", "11101101000", "11101100010", "11100011010", "11101111010", "11001000010", "11110001010", "10100110000",
  "10100001100", "10010110000", "10010000110", "10000101100", "10000100110", "10110010000", "10110000100", "10011010000",
  "10011000010", "10000110100", "10000110010", "11000010010", "11001010000", "11110111010", "11000010100", "10001111010",
  "10100111100", "10010111100", "10010011110", "10111100100", "10011110100", "10011110010", "11110100100", "11110010100",
  "11110010010", "11011011110", "11011110110", "11110110110", "10101111000", "10100011110", "10001011110", "10111101000",
  "10111100010", "11110101000", "11110100010", "10111011110", "10111101110", "11101011110", "11110101110", "11010000100",
  "11010010000", "11010011100", "1100011101011",
] as const;

const START_B = 104;
const START_C = 105;
const STOP = 106;
/** Quiet zone either side, in modules (the standard asks for at least 10). */
export const CODE128_QUIET_ZONE = 10;

/** The symbol values of a Code 128 barcode for `text`, including start, check and stop symbols. */
export function code128Values(text: string): number[] {
  if (text.length === 0) throw new Error("Nothing to encode");
  let values: number[];
  if (/^\d+$/.test(text) && text.length % 2 === 0) {
    values = [START_C];
    for (let i = 0; i < text.length; i += 2) values.push(Number(text.slice(i, i + 2)));
  } else {
    values = [START_B];
    for (const ch of text) {
      const code = ch.charCodeAt(0);
      if (code < 32 || code > 127) throw new Error(`Code 128 set B cannot encode ${JSON.stringify(ch)}`);
      values.push(code - 32);
    }
  }
  // Check symbol: start value plus each data value times its position, modulo 103.
  const check = values.reduce((sum, value, i) => sum + value * Math.max(i, 1), 0) % 103;
  return [...values, check, STOP];
}

/** The barcode as modules (true = bar), without quiet zones. */
export function code128Modules(text: string): boolean[] {
  return code128Values(text)
    .map((value) => PATTERNS[value]!)
    .join("")
    .split("")
    .map((m) => m === "1");
}

/** The symbol patterns (exposed for tests). */
export const CODE128_PATTERNS: readonly string[] = PATTERNS;
