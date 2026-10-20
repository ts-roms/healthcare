import { describe, expect, it } from "vitest";
import { manualSections, plainText, searchManual } from "./manual-search";

const chapters = [
  {
    slug: "patients",
    title: "Patients",
    source:
      "# 2. Patients\n\nFind and register patients.\n\n## How to register a patient\n\nClick **New patient** and fill in the `details`.\n\n### Duplicates\n\nPossible duplicates are shown first.\n",
  },
  {
    slug: "billing",
    title: "Billing",
    source: "# 10. Billing\n\n## How to issue an invoice\n\nOpen the patient's charges and select Issue. A [discount](02-patients.md) needs evidence.\n",
  },
];

describe("manual search", () => {
  it("strips Markdown marks to plain words", () => {
    expect(plainText("Click **New patient** and fill in the `details` of a [link](x.md).")).toBe("Click New patient and fill in the details of a link.");
  });

  it("splits chapters into sections with the anchors the Markdown view gives headings", () => {
    const sections = manualSections(chapters);
    expect(sections.map((s) => [s.heading, s.href])).toEqual([
      ["Patients", "/help/patients"],
      ["How to register a patient", "/help/patients#how-to-register-a-patient"],
      ["Duplicates", "/help/patients#duplicates"],
      ["How to issue an invoice", "/help/billing#how-to-issue-an-invoice"],
    ]);
    // A one-page manual links within the page.
    expect(manualSections([{ slug: "", title: "Guide", source: "# Guide\n\n## Sign in\n\nText" }]).map((s) => s.href)).toEqual(["#sign-in"]);
  });

  it("finds sections containing every word, heading matches first, with a snippet", () => {
    const sections = manualSections(chapters);
    const hits = searchManual(sections, "patient");
    // Both "Patients" and "How to register a patient" match in the heading; ties keep the manual's order.
    expect(hits.map((h) => h.heading)).toEqual(["Patients", "How to register a patient", "How to issue an invoice"]);
    expect(hits[1]!.snippet).toContain("New patient");
    expect(searchManual(sections, "duplicates shown").map((h) => h.heading)).toEqual(["Duplicates"]);
    expect(searchManual(sections, "nothing here")).toEqual([]);
    expect(searchManual(sections, "   ")).toEqual([]);
  });
});
