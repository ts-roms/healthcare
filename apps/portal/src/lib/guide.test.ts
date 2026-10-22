import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { guideHref, patientFaq, patientGuide, patientGuideWithFaq } from "./guide";

const CHAPTER = readFileSync(new URL("../../../../docs/manual/12-patient-portal.md", import.meta.url), "utf8");
const FAQ = readFileSync(new URL("../../../../docs/manual/14-glossary-and-faq.md", import.meta.url), "utf8");

describe("patient guide", () => {
  it("drops the title and the sections written for staff", () => {
    const guide = patientGuide(
      "# 12. MyHealth\n\nIntro\n\n## How to sign in\n\nSteps\n\n## For clinic staff\n\nStaff only\n\n## Related chapters\n\n- [x](02-patients.md)\n",
    );
    expect(guide).toBe("Intro\n\n## How to sign in\n\nSteps");
  });

  it("keeps the real chapter's patient sections and removes its staff section", () => {
    const guide = patientGuide(CHAPTER);
    expect(guide).toContain("## How to set up your account");
    expect(guide).not.toContain("## For clinic staff");
    expect(guide).not.toMatch(/^# /m);
  });

  it("ends the guide with the manual's questions for patients, and only those", () => {
    const faq = patientFaq("# 14. FAQ\n\n## FAQ\n\n### For staff\n\n**1. Staff?**\nAnswer.\n\n### For patients\n\n**2. Patients?**\nAnswer for patients.\n\n## Related chapters\n\n- x\n");
    expect(faq).toBe("## Frequently asked questions\n\n**2. Patients?**\nAnswer for patients.");
    expect(patientFaq("# Nothing\n\n## FAQ\n\n### For staff\n\nOnly staff\n")).toBe("");
    const guide = patientGuideWithFaq(CHAPTER, FAQ);
    expect(guide).toContain("## Frequently asked questions");
    expect(guide).toContain("activation code");
    expect(guide).not.toContain("### For staff");
    expect(guide).not.toContain("separation of duties");
    // Without a FAQ the guide is unchanged.
    expect(patientGuideWithFaq(CHAPTER, "# 14\n")).toBe(patientGuide(CHAPTER));
  });

  it("keeps on-page anchors and shows links to staff chapters as text", () => {
    expect(guideHref("#how-to-sign-in-and-sign-out")).toBe("#how-to-sign-in-and-sign-out");
    expect(guideHref("02-patients.md")).toBeNull();
  });
});
