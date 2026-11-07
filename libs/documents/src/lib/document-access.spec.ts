import { DOCUMENT_CATEGORIES } from "./document.schema";
import { DOCUMENT_CATEGORY_PERMISSION, documentCategoryReadable } from "./document-access";

describe("documentCategoryReadable", () => {
  const read = new Set(["document.read"]);

  it("opens the record's ordinary documents with document.read alone", () => {
    expect(documentCategoryReadable("consent_form", read)).toBe(true);
    expect(documentCategoryReadable("clinical_attachment", read)).toBe(true);
  });

  it("needs the guarding domain's permission for its categories", () => {
    expect(documentCategoryReadable("imaging", read)).toBe(false);
    expect(documentCategoryReadable("imaging", new Set(["document.read", "dental.imaging.read"]))).toBe(true);
    expect(documentCategoryReadable("outside_result", read)).toBe(false);
    expect(documentCategoryReadable("record_copy", read)).toBe(false);
  });

  it("lets the records office open every category of the record", () => {
    const office = new Set(["document.read", "patient.records-request.manage"]);
    expect(documentCategoryReadable("imaging", office)).toBe(true);
    expect(documentCategoryReadable("record_copy", office)).toBe(true);
  });

  it("never serves management report files through the generic routes", () => {
    const everything = new Set(["document.read", "patient.records-request.manage", "management.report.manage", "management.dashboard.read"]);
    expect(documentCategoryReadable("management_report", everything)).toBe(false);
  });

  it("has a rule for every category", () => {
    expect(Object.keys(DOCUMENT_CATEGORY_PERMISSION).sort()).toEqual([...DOCUMENT_CATEGORIES].sort());
  });
});
