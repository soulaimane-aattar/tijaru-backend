import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { CapabilityId } from '../../domain/permissions';
import type { AuthUser } from '../auth/auth-user.type';
import { REQUIRE_CAP_KEY } from '../decorators/require-cap.decorator';
import { ForbiddenError, UnauthorizedError } from '../errors';

/**
 * Checks an AuthUser against required caps using the token-baked effective set:
 *   roleCaps (role + role customizations resolved at login) overlaid by overrides.
 */
function userHasCap(user: AuthUser, cap: CapabilityId): boolean {
  const override = user.overrides[cap];
  if (override !== undefined) return override;
  return user.roleCaps.includes(cap);
}

@Injectable()
export class CapsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<CapabilityId[] | undefined>(REQUIRE_CAP_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user) throw new UnauthorizedError();
    if (user.isSuperAdmin) return true;

    for (const cap of required) {
      if (!userHasCap(user, cap)) throw new ForbiddenError(cap);
    }
    return true;
  }
}
