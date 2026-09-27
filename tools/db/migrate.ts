/**
 * Applies database migrations: `pnpm db:migrate`.
 * Uses DATABASE_URL (or the URL given as the first argument).
 */
import "dotenv/config";
import { join } from "node:path";
import { Pool } from "pg";
import { runMigrations } from "../../libs/core/src/lib/database/migrator";

async function main(): Promise<void> {
  const url = process.argv[2] ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const result = await runMigrations(pool, join(__dirname, "../../database/migrations"));
    for (const name of result.applied) console.log(`applied  ${name}`);
    console.log(`${result.applied.length} applied, ${result.skipped.length} already up to date`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
