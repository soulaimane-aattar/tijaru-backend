import { type CanActivate, type ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';
import { CAPABILITY_IDS, type CapabilityId, type RoleId } from '../../domain/permissions';
import {
  apiKeyMatches,
  API_KEY_PREFIX,
  prefixOf,
} from '../../modules/integrations/domain/webhook-signature';
import type { AuthUser } from '../auth/auth-user.type';
import { UnauthorizedError } from '../errors';
import { PrismaService } from '../prisma.service';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

type AccessJwtPayload = {
  sub: string;
  type?: 'platform-admin' | 'user';
  role?: RoleId;
  ver: number;
  caps?: CapabilityId[];
  overrides?: Partial<Record<CapabilityId, boolean>>;
  bid?: string;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    @Inject(ENV_TOKEN) private readonly env: Env,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing bearer token');
    }
    const token = header.slice('Bearer '.length);

    // Machine callers (Odoo, Zapier, scripts) present a `tj_…` API key on the
    // same header, so every existing endpoint works for them unchanged.
    if (token.startsWith(API_KEY_PREFIX)) {
      request.user = await this.authenticateApiKey(token);
      return true;
    }

    let payload: AccessJwtPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessJwtPayload>(token, {
        secret: this.env.JWT_ACCESS_SECRET,
      });
    } catch {
      throw new UnauthorizedError('Invalid or expired token');
    }

    if (payload.type === 'platform-admin') {
      request.user = {
        id: payload.sub,
        businessId: '',
        role: 'owner' as RoleId,
        tokenVersion: payload.ver,
        roleCaps: [...CAPABILITY_IDS],
        overrides: {},
        isSuperAdmin: true,
        device: request.headers['user-agent'],
      };
    } else {
      request.user = {
        id: payload.sub,
        businessId: payload.bid ?? '',
        role: payload.role!,
        tokenVersion: payload.ver,
        roleCaps: payload.caps ?? [],
        overrides: payload.overrides ?? {},
        device: request.headers['user-agent'],
      };
    }
    return true;
  }

  /** Looks the key up by its public prefix, then compares hashes in constant time. */
  private async authenticateApiKey(token: string): Promise<AuthUser> {
    const prefix = prefixOf(token);
    if (!prefix) throw new UnauthorizedError('Invalid API key');

    const key = await this.prisma.apiKey.findUnique({ where: { prefix } });
    if (!key || key.revokedAt || !apiKeyMatches(token, key.hash)) {
      throw new UnauthorizedError('Invalid API key');
    }
    await this.prisma.apiKey.update({
      where: { id: key.id },
      data: { lastUsedAt: new Date() },
    });

    return {
      id: `apikey:${key.id}`,
      businessId: key.businessId,
      role: 'owner' as RoleId,
      tokenVersion: 0,
      roleCaps: [...CAPABILITY_IDS],
      overrides: {},
      device: 'api-key',
    };
  }
}
