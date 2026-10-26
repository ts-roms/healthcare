import { describe, expect, it } from "vitest";
import { outsideResultFormSchema, outsideResultPayload } from "./outside-result-form";

const valid = {
  sourceName: "St. Luke's Laboratory",
  sourceKind: "laboratory",
  performedOn: "2026-10-20",
  tests: "CBC, HbA1c",
  receivedFrom: "patient",
  notes: "",
};

describe("outside result form", () => {
  const schema = outsideResultFormSchema("2026-10-26");

  it("accepts a complete filing", () => {
    expect(schema.safeParse(valid).success).toBe(true);
  });

  it("asks for the source, the tests and a real day", () => {
    expect(schema.safeParse({ ...valid, sourceName: " " }).error?.issues[0]?.message).toMatch(/Name the laboratory/);
    expect(schema.safeParse({ ...valid, tests: "" }).error?.issues[0]?.message).toMatch(/which tests/);
    expect(schema.safeParse({ ...valid, performedOn: "" }).error?.issues[0]?.message).toMatch(/day the test was done/);
  });

  it("refuses a day in the future but accepts today", () => {
    expect(schema.safeParse({ ...valid, performedOn: "2026-10-27" }).error?.issues[0]?.message).toMatch(/future/);
    expect(schema.safeParse({ ...valid, performedOn: "2026-10-26" }).success).toBe(true);
  });

  it("leaves empty notes out of the request", () => {
    const parsed = schema.parse(valid);
    expect(outsideResultPayload(parsed, "doc-1")).not.toHaveProperty("notes");
    expect(outsideResultPayload({ ...parsed, notes: "Brought by a relative" }, "doc-1")).toMatchObject({ documentId: "doc-1", notes: "Brought by a relative" });
  });
});
