import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { guideHref, patientGuide } from "./guide";

const CHAPTER = readFileSync(new URL("../../../../docs/manual/12-patient-portal.md", import.meta.url), "utf8");

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

  it("keeps on-page anchors and shows links to staff chapters as text", () => {
    expect(guideHref("#how-to-sign-in-and-sign-out")).toBe("#how-to-sign-in-and-sign-out");
    expect(guideHref("02-patients.md")).toBeNull();
  });
});
