import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

import { UnauthorizedError } from '../../common/errors';
import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';

type PlatformAdminPayload = {
  sub: string;
  type: 'platform-admin';
  ver: number;
};

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing bearer token');
    }

    let payload: PlatformAdminPayload;
    try {
      payload = await this.jwt.verifyAsync<PlatformAdminPayload>(header.slice(7), {
        secret: this.env.JWT_ACCESS_SECRET,
      });
    } catch {
      throw new UnauthorizedError('Invalid or expired token');
    }

    if (payload.type !== 'platform-admin') {
      throw new UnauthorizedError('Not a platform admin token');
    }

    return true;
  }
}
