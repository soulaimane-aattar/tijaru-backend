import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/guards/jwt.guard';
import { PrismaService } from '../../common/prisma.service';

// Version-neutral on purpose: the nginx reverse proxy probes a fixed
// `/api/health`, so this route must not move when the API version bumps.
@ApiTags('health')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness + database reachability probe' })
  async check(): Promise<{ status: 'ok' | 'degraded'; database: 'up' | 'down' }> {
    let database: 'up' | 'down' = 'down';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = 'up';
    } catch {
      database = 'down';
    }
    return { status: database === 'up' ? 'ok' : 'degraded', database };
  }
}
