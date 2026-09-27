import * as audit from '@healthcare/audit';
import * as auth from '@healthcare/auth';
import * as documents from '@healthcare/documents';
import * as notification from '@healthcare/notification';
import * as organization from '@healthcare/organization';
import * as patient from '@healthcare/patient';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';
import { resetDatabase, TEST_DATABASE_URL } from './harness';

/**
 * Migrations are the source of truth for the schema; the Drizzle table
 * definitions in each library must mirror them. This catches drift.
 */
describe('Drizzle schema matches migrations', () => {
  let pool: Pool;
  const tables = [audit, auth, documents, notification, organization, patient]
    .flatMap((module) => Object.values(module))
    .filter((value): value is PgTable => value instanceof PgTable);

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
    await resetDatabase(pool);
  });

  afterAll(() => pool.end());

  it('covers the tables', () => {
    expect(tables.length).toBeGreaterThanOrEqual(20);
  });

  it.each(tables.map((table) => [getTableConfig(table).name, table] as const))('%s', async (name, table) => {
    const { rows } = await pool.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
      [name],
    );
    const database = Object.fromEntries(rows.map((r) => [r.column_name, r.is_nullable === 'NO']));
    const code = Object.fromEntries(getTableConfig(table).columns.map((c) => [c.name, c.notNull]));
    expect(code).toEqual(database);
  });
});
