import { Global, Inject, Module, OnApplicationShutdown } from "@nestjs/common";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { APP_CONFIG, type AppConfig } from "../config/app-config";
import { DATABASE, DATABASE_POOL } from "./database";
import { ContextPool } from "./database-context";

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      inject: [APP_CONFIG],
      // Each connection is stamped with the row-level security context before use (database-context.ts, migration 0111).
      useFactory: (config: AppConfig): Pool =>
        new ContextPool({ connectionString: config.DATABASE_URL, max: config.DATABASE_POOL_MAX }, config.DATABASE_RLS_MODE),
    },
    {
      provide: DATABASE,
      inject: [DATABASE_POOL],
      useFactory: (pool: Pool) => drizzle(pool),
    },
  ],
  exports: [DATABASE, DATABASE_POOL],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
