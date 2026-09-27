import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { DATABASE, DATABASE_POOL } from './database';

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new Pool({ connectionString: config.DATABASE_URL, max: config.DATABASE_POOL_MAX }),
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
