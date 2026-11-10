import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ENV, type Env } from '../config/env.js';
import { DB, type Database } from '../db/db.provider.js';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  async check(): Promise<{ status: 'ok'; db: 'ok'; revision: string }> {
    const revision = this.env.BUILD_SHA;
    try {
      await this.db.execute(sql`select 1`);
    } catch {
      throw new ServiceUnavailableException({ status: 'error', db: 'down', revision });
    }
    return { status: 'ok', db: 'ok', revision };
  }
}
