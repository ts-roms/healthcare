import "server-only";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { chapterSlug, chapterTitle, type ManualChapter } from "./manual";

/**
 * The user manual is read from `docs/manual` in the repository, so the Markdown stays the single source. The app
 * runs from its own folder or the repository root (dev, `next start`, e2e); the folder is found by walking up.
 */
function manualDir(): string {
  for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, "docs", "manual");
    if (existsSync(/*turbopackIgnore: true*/ path.join(candidate, "README.md"))) return candidate;
    if (path.dirname(dir) === dir) throw new Error("The user manual (docs/manual) was not found");
  }
}

interface Manual {
  index: string;
  chapters: (ManualChapter & { source: string })[];
}

let cached: Manual | undefined;

/** The manual's index and chapters in file order, read once per server process. */
export function loadManual(): Manual {
  if (cached) return cached;
  const dir = manualDir();
  const read = (file: string) => readFileSync(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ dir, file), "utf8");
  const chapters = readdirSync(/*turbopackIgnore: true*/ dir)
    .filter((file) => chapterSlug(file))
    .sort()
    .map((file) => {
      const source = read(file);
      return { slug: chapterSlug(file) as string, file, title: chapterTitle(source), source };
    });
  cached = { index: read("README.md"), chapters };
  return cached;
}
