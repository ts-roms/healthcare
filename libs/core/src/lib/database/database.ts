import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

export type Database = NodePgDatabase;

/** Either the root database handle or an open transaction. */
export type DbExecutor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

export const DATABASE = Symbol('DATABASE');
export const DATABASE_POOL = Symbol('DATABASE_POOL');

/** PostgreSQL error codes the application reacts to. */
export const PgErrorCode = {
  uniqueViolation: '23505',
  foreignKeyViolation: '23503',
  checkViolation: '23514',
  notNullViolation: '23502',
  insufficientPrivilege: '42501',
} as const;

export interface PgError {
  code: string;
  constraint?: string;
  detail?: string;
}

/** Drizzle wraps driver errors; unwrap to the underlying pg error if there is one. */
export function asPgError(error: unknown): PgError | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current; depth++) {
    if (typeof current === 'object' && current !== null && 'code' in current && typeof current.code === 'string') {
      return current as PgError;
    }
    current = typeof current === 'object' && current !== null && 'cause' in current ? current.cause : undefined;
  }
  return undefined;
}
