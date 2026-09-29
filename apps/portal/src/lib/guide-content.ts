import "server-only";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const CHAPTER = path.join("docs", "manual", "12-patient-portal.md");

let cached: string | undefined;

/**
 * The manual's MyHealth chapter, read from the repository so the Markdown stays the single source. The app runs
 * from its own folder or the repository root (dev, `next start`, e2e); the file is found by walking up.
 */
export function loadGuideChapter(): string {
  if (cached !== undefined) return cached;
  for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
    const file = path.join(dir, CHAPTER);
    if (existsSync(/*turbopackIgnore: true*/ file)) return (cached = readFileSync(/*turbopackIgnore: true*/ file, "utf8"));
    if (path.dirname(dir) === dir) throw new Error(`The MyHealth guide (${CHAPTER}) was not found`);
  }
}
