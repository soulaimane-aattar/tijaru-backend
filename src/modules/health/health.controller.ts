import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { sql } from 'kysely';

import { Public } from '../../common/guards/jwt.guard';
import { Db } from '../../database';

// Version-neutral on purpose: the nginx reverse proxy probes a fixed
// `/api/health`, so this route must not move when the API version bumps.
@ApiTags('health')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly db: Db) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness + database reachability probe' })
  async check(): Promise<{ status: 'ok' | 'degraded'; database: 'up' | 'down' }> {
    let database: 'up' | 'down' = 'down';
    try {
      await sql`SELECT 1`.execute(this.db.q);
      database = 'up';
    } catch {
      database = 'down';
    }
    return { status: database === 'up' ? 'ok' : 'degraded', database };
  }
}
