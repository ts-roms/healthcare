import "server-only";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const CHAPTER = path.join("docs", "manual", "12-patient-portal.md");
const FAQ_CHAPTER = path.join("docs", "manual", "14-glossary-and-faq.md");

const cached = new Map<string, string>();

function loadChapter(relative: string): string {
  const hit = cached.get(relative);
  if (hit !== undefined) return hit;
  for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
    const file = path.join(dir, relative);
    if (existsSync(/*turbopackIgnore: true*/ file)) {
      const source = readFileSync(/*turbopackIgnore: true*/ file, "utf8");
      cached.set(relative, source);
      return source;
    }
    if (path.dirname(dir) === dir) throw new Error(`The MyHealth guide (${relative}) was not found`);
  }
}

/**
 * The manual's MyHealth chapter, read from the repository so the Markdown stays the single source. The app runs
 * from its own folder or the repository root (dev, `next start`, e2e); the file is found by walking up.
 */
export function loadGuideChapter(): string {
  return loadChapter(CHAPTER);
}

/** The manual's glossary-and-FAQ chapter, whose "For patients" questions end the guide. */
export function loadGuideFaqChapter(): string {
  return loadChapter(FAQ_CHAPTER);
}
