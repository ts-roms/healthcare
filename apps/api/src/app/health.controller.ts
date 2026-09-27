import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { DATABASE, type Database, Public } from '@healthcare/core';
import { sql } from 'drizzle-orm';

@ApiTags('health')
@Controller({ path: 'health', version: '1' })
@SkipThrottle()
export class HealthController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Liveness: the process is up. */
  @Get('live')
  @Public()
  live() {
    return { status: 'ok' };
  }

  /** Readiness: dependencies are reachable. */
  @Get('ready')
  @Public()
  async ready() {
    await this.db.execute(sql`SELECT 1`);
    return { status: 'ok', database: 'ok' };
  }
}
