import { instrumentValue } from "./instrument-interface.rules";

const numeric = { resultType: "numeric" as const, unit: "mmol/L", name: "Glucose" };

describe("instrument result values", () => {
  it("accepts a plain decimal number in the test's unit", () => {
    expect(instrumentValue(numeric, "6.1", "mmol/L")).toEqual({ ok: true, input: { valueNumeric: 6.1 } });
    expect(instrumentValue(numeric, " 6 ", "MMOL/L")).toEqual({ ok: true, input: { valueNumeric: 6 } });
    expect(instrumentValue(numeric, "-0.5", null)).toEqual({ ok: true, input: { valueNumeric: -0.5 } });
  });

  it("refuses qualified or malformed numbers and a different unit (no conversion)", () => {
    expect(instrumentValue(numeric, "<0.5", "mmol/L")).toMatchObject({ ok: false, code: "instrument_value_not_numeric" });
    expect(instrumentValue(numeric, "1e3", "mmol/L")).toMatchObject({ ok: false, code: "instrument_value_not_numeric" });
    expect(instrumentValue(numeric, "1,200", "mmol/L")).toMatchObject({ ok: false, code: "instrument_value_not_numeric" });
    expect(instrumentValue(numeric, "110", "mg/dL")).toMatchObject({ ok: false, code: "instrument_unit_mismatch" });
    expect(instrumentValue(numeric, "", null)).toMatchObject({ ok: false, code: "instrument_value_empty" });
  });

  it("passes coded and text values through (coded values are checked at entry)", () => {
    expect(instrumentValue({ resultType: "coded", unit: null, name: "HBsAg" }, "negative", null)).toEqual({ ok: true, input: { valueCoded: "negative" } });
    expect(instrumentValue({ resultType: "text", unit: null, name: "Smear" }, "No parasites seen", null)).toEqual({
      ok: true,
      input: { valueText: "No parasites seen" },
    });
  });
});
