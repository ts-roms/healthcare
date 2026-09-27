import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pool } from 'pg';

const MIGRATION_FILE = /^(\d{4})_[a-z0-9_]+\.sql$/;
// Arbitrary constant so concurrent deploys serialize on the same advisory lock.
const MIGRATION_LOCK_ID = 7_214_031;

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/**
 * Applies forward-only SQL migrations in filename order, each in its own
 * transaction. Already-applied files are verified by checksum so an edited
 * migration is detected instead of silently diverging.
 */
export async function runMigrations(pool: Pool, directory: string): Promise<MigrationResult> {
  const files = (await readdir(directory)).filter((name) => MIGRATION_FILE.test(name)).sort();
  const client = await pool.connect();
  const result: MigrationResult = { applied: [], skipped: [] };
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migration (
        name        text        PRIMARY KEY,
        checksum    text        NOT NULL,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )`);
    const { rows } = await client.query<{ name: string; checksum: string }>('SELECT name, checksum FROM schema_migration');
    const applied = new Map(rows.map((row) => [row.name, row.checksum]));

    for (const file of files) {
      const sql = await readFile(join(directory, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = applied.get(file);
      if (previous !== undefined) {
        if (previous !== checksum) {
          throw new Error(`Migration ${file} was modified after being applied. Add a new migration instead.`);
        }
        result.skipped.push(file);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migration (name, checksum) VALUES ($1, $2)', [file, checksum]);
        await client.query('COMMIT');
        result.applied.push(file);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`, { cause: error });
      }
    }
    return result;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => undefined);
    client.release();
  }
}
