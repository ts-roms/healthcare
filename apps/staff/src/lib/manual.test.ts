import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chapterForPath, chapterSlug, chapterTitle, manualHref, withoutTitle } from "./manual";

const MANUAL_DIR = new URL("../../../../docs/manual/", import.meta.url);

describe("manual", () => {
  it("derives chapter slugs and titles", () => {
    expect(chapterSlug("02-patients.md")).toBe("patients");
    expect(chapterSlug("README.md")).toBeNull();
    expect(chapterTitle("# 2. Patients\n\nText")).toBe("Patients");
    expect(withoutTitle("# 2. Patients\n\nText")).toBe("Text");
  });

  it("maps manual links to /help and drops links to developer documentation", () => {
    expect(manualHref("06-laboratory.md#how-to-enter-results")).toBe("/help/laboratory#how-to-enter-results");
    expect(manualHref("README.md")).toBe("/help");
    expect(manualHref("#rules")).toBe("#rules");
    expect(manualHref("https://example.org")).toBe("https://example.org");
    expect(manualHref("../architecture/overview.md")).toBeNull();
  });

  it("names the chapter about a screen by its route, longest prefix first", () => {
    expect(chapterForPath("/")).toBe("getting-started");
    expect(chapterForPath("/laboratory/worklist")).toBe("laboratory");
    expect(chapterForPath("/laboratory/qc")).toBe("laboratory-quality");
    expect(chapterForPath("/admin/integrations")).toBe("records-reporting-and-integrations");
    expect(chapterForPath("/admin/users/abc")).toBe("administration");
    expect(chapterForPath("/help/patients")).toBeNull();
    expect(chapterForPath("/patientsx")).toBeNull();
  });

  it("maps every screen's chapter to a chapter file of docs/manual", () => {
    const slugs = new Set(readdirSync(MANUAL_DIR).map(chapterSlug).filter(Boolean));
    for (const path of [
      "/",
      "/patients",
      "/appointments",
      "/clinic",
      "/laboratory",
      "/laboratory/qc",
      "/dental",
      "/billing",
      "/inventory",
      "/records",
      "/admin",
    ]) {
      expect(slugs.has(chapterForPath(path))).toBe(true);
    }
  });

  it("resolves every link between chapters of docs/manual to a chapter that exists", () => {
    const files = readdirSync(MANUAL_DIR).filter((f) => f.endsWith(".md"));
    const slugs = new Set(files.map(chapterSlug).filter(Boolean));
    for (const file of files) {
      const source = readFileSync(new URL(file, MANUAL_DIR), "utf8");
      expect(chapterSlug(file) === null || chapterTitle(source).length > 0).toBe(true);
      for (const [, href = ""] of source.matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = manualHref(href);
        if (target?.startsWith("/help/")) expect(slugs.has(target.slice(6).split("#")[0] ?? "")).toBe(true);
      }
    }
  });
});
