import type { ResultValueInput } from "../laboratory.dto";
import type { ResultType } from "../laboratory.schema";

/** A strict decimal number as analyzers send it: no exponents, thousands separators or leading "<" / ">" qualifiers. */
const DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

const normalizeUnit = (unit: string) => unit.trim().toLowerCase().replace(/\s+/g, "");

/**
 * Turns what an analyzer sent into a result value for the test, or says why it cannot be accepted as is. A numeric test
 * takes a plain decimal number (a qualified value such as "<0.5" is entered by hand); when both the analyzer and the test
 * state a unit they must be the same (ignoring case and spaces) — no conversion is attempted. A coded test takes one of
 * its coded values (checked again at entry); a text test takes the text.
 */
export function instrumentValue(
  test: { resultType: ResultType; unit: string | null; name: string },
  valueRaw: string,
  unitsRaw: string | null,
): { ok: true; input: Pick<ResultValueInput, "valueNumeric" | "valueText" | "valueCoded"> } | { ok: false; code: string; message: string } {
  const value = valueRaw.trim();
  if (!value) return { ok: false, code: "instrument_value_empty", message: "The instrument sent no value" };
  if (test.resultType === "numeric") {
    if (!DECIMAL.test(value)) {
      return { ok: false, code: "instrument_value_not_numeric", message: `${test.name} takes a number; the instrument sent "${value}". Enter it by hand.` };
    }
    if (test.unit && unitsRaw && normalizeUnit(test.unit) !== normalizeUnit(unitsRaw)) {
      return {
        ok: false,
        code: "instrument_unit_mismatch",
        message: `The instrument reports ${test.name} in ${unitsRaw}; the catalog uses ${test.unit}. Check the instrument's settings or enter it by hand.`,
      };
    }
    return { ok: true, input: { valueNumeric: Number(value) } };
  }
  if (test.resultType === "coded") return { ok: true, input: { valueCoded: value.slice(0, 60) } };
  return { ok: true, input: { valueText: value } };
}
