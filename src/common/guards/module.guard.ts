import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { Db } from '../../database';
import type { AuthUser } from '../auth/auth-user.type';
import { REQUIRE_MODULE_KEY } from '../decorators/require-module.decorator';
import { ForbiddenError } from '../errors';

@Injectable()
export class ModuleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: Db,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const moduleId = this.reflector.getAllAndOverride<string | undefined>(REQUIRE_MODULE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!moduleId) return true;

    const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user || user.isSuperAdmin) return true;

    // Guards run before the tenant transaction exists → owner pool, explicit id filters.
    const mod = await this.db.admin
      .selectFrom('app.business_modules')
      .select('active')
      .where('business_id', '=', user.businessId)
      .where('module_id', '=', moduleId)
      .executeTakeFirst();

    if (!mod?.active) {
      throw new ForbiddenError(`module_disabled:${moduleId}`);
    }

    // Per-employee allow-list. Read from the DB (not the JWT) so a change by the
    // owner takes effect on the very next request. Owners are never restricted.
    if (user.role !== 'owner') {
      const row = await this.db.admin
        .selectFrom('app_auth.users')
        .select(['restrict_modules', 'module_access'])
        .where('id', '=', user.id)
        .executeTakeFirst();
      if (row?.restrict_modules && !row.module_access.includes(moduleId)) {
        throw new ForbiddenError(`module_forbidden:${moduleId}`);
      }
    }

    return true;
  }
}
