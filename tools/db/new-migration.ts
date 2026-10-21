/**
 * Creates the next numbered, empty migration: `pnpm db:migrate:new add_widget` → database/migrations/0118_add_widget.sql.
 * Migrations are hand-written, forward-only SQL; apply with `pnpm db:migrate`. Never edit an applied one.
 */
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(__dirname, "../../database/migrations");
const name = (process.argv[2] ?? "")
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "_")
  .replace(/^_+|_+$/g, "");
if (!name) {
  console.error("Usage: pnpm db:migrate:new <short_description>");
  process.exit(1);
}
const last = Math.max(0, ...readdirSync(dir).map((f) => Number(/^(\d{4})_/.exec(f)?.[1] ?? 0)));
const file = join(dir, `${String(last + 1).padStart(4, "0")}_${name}.sql`);
if (existsSync(file)) throw new Error(`${file} already exists`);
writeFileSync(file, `-- ${name.replace(/_/g, " ")}\n\n`);
console.log(`created  ${file}`);
