import { describe, expect, it } from "vitest";
import { describeTriggers, formValues, parsePrefixes, triggersFrom } from "./order-set-form";

describe("order set form", () => {
  it("reads diagnosis code prefixes typed in any way", () => {
    expect(parsePrefixes("e11, E10  i10;e11")).toEqual(["E11", "E10", "I10"]);
    expect(parsePrefixes("O24.4")).toEqual(["O24.4"]);
    expect(parsePrefixes("  ")).toEqual([]);
  });

  it("builds the triggers, with the coding system only when one is chosen", () => {
    expect(triggersFrom(["E11"], "icd-10", ["dm-clinic"])).toEqual([
      { kind: "diagnosis_code", value: "E11", codeSystemKey: "icd-10" },
      { kind: "visit_type", value: "dm-clinic" },
    ]);
    expect(triggersFrom(["E11"], null, [])).toEqual([{ kind: "diagnosis_code", value: "E11" }]);
  });

  it("says when a set is offered", () => {
    const set = {
      triggers: [
        { kind: "diagnosis_code" as const, value: "E11", codeSystemKey: "icd-10" },
        { kind: "diagnosis_code" as const, value: "E10", codeSystemKey: "icd-10" },
        { kind: "visit_type" as const, value: "dm-clinic", codeSystemKey: null },
      ],
    };
    expect(
      describeTriggers(
        set,
        (c) => (c === "dm-clinic" ? "Diabetes clinic" : c),
        (k) => k.toUpperCase(),
      ),
    ).toBe("Diagnoses starting with E11, E10 (ICD-10) · Visit types: Diabetes clinic");
    expect(
      describeTriggers(
        { triggers: [] },
        (c) => c,
        (k) => k,
      ),
    ).toBe("Chosen by hand only");
  });

  it("puts a set back into the form's fields", () => {
    expect(
      formValues({
        triggers: [
          { kind: "diagnosis_code", value: "E11", codeSystemKey: "icd-10" },
          { kind: "visit_type", value: "dm-clinic", codeSystemKey: null },
        ],
      }),
    ).toEqual({ prefixes: "E11", codeSystemKey: "icd-10", visitTypeCodes: ["dm-clinic"] });
  });
});
