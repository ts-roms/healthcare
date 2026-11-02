import { safeErrorSummary } from "./safe-error";

describe("safeErrorSummary", () => {
  it("never repeats the parameters of a failed query", () => {
    const cause = new Error('duplicate key value violates unique constraint "patient_number_key"');
    const error = new Error('Failed query: insert into patient (name) values ($1)\nparams: Maria Santos', { cause });
    const text = safeErrorSummary(error);
    expect(text).not.toContain("Maria Santos");
    expect(text).not.toContain("insert into patient");
    expect(text).toContain("patient_number_key");
    expect(text).toContain("    at ");
  });

  it("keeps the message of an ordinary error", () => {
    expect(safeErrorSummary(new TypeError("x is not a function"))).toContain("TypeError: x is not a function");
  });

  it("does not stringify a thrown non-error", () => {
    expect(safeErrorSummary({ secret: "value" })).toBe("non-error exception");
  });
});
