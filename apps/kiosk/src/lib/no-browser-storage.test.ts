import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) && !name.includes(".test.") ? [path] : [];
  });

/**
 * The kiosk's privacy rule: nothing a patient types or is shown may reach browser storage or a script-readable cookie.
 * The person's session token lives in an httpOnly cookie set by the server; the form state lives in memory.
 */
describe("kiosk privacy rule", () => {
  const banned = [
    /localStorage/,
    /sessionStorage/,
    /indexedDB/,
    /document\.cookie/,
    /caches\.open/,
    /navigator\.serviceWorker/,
    /history\.(push|replace)State/,
  ];
  for (const file of files(join(__dirname, ".."))) {
    it(`${file.split(/[\\/]src[\\/]/)[1]} uses no browser storage`, () => {
      const source = readFileSync(file, "utf8");
      for (const pattern of banned) expect(source).not.toMatch(pattern);
    });
  }
});
