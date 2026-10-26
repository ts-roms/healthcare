import { describe, expect, it } from "vitest";
import { fillWording, unknownPlaceholders, worstCaseLength } from "./outreach-mapping";

describe("outreach wording variables", () => {
  it("fills in the first name and the clinic's name", () => {
    expect(fillWording("Hello {{firstName}}, {{ clinicName }} has flu shots.", "Maria", "Demo Health")).toBe("Hello Maria, Demo Health has flu shots.");
  });

  it("counts the length with the longest first name, like the API does", () => {
    expect(worstCaseLength("Hi {{firstName}}", "Demo")).toBe(33);
    expect(worstCaseLength("No variables here", "Demo")).toBe(17);
  });

  it("names a placeholder the platform does not fill in", () => {
    expect(unknownPlaceholders("{{firstName}} {{balance}} {{balance}}")).toEqual(["balance"]);
    expect(unknownPlaceholders("{{firstName}} at {{clinicName}}")).toEqual([]);
  });
});
