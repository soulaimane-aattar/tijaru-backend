import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { AuthUser } from '../auth/auth-user.type';
import { REQUIRE_MODULE_KEY } from '../decorators/require-module.decorator';
import { ForbiddenError } from '../errors';
import { PrismaService } from '../prisma.service';

@Injectable()
export class ModuleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const moduleId = this.reflector.getAllAndOverride<string | undefined>(REQUIRE_MODULE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!moduleId) return true;

    const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user || user.isSuperAdmin) return true;

    const mod = await this.prisma.businessModule.findUnique({
      where: { businessId_moduleId: { businessId: user.businessId, moduleId } },
    });

    if (!mod?.active) {
      throw new ForbiddenError(`module_disabled:${moduleId}`);
    }

    // Per-employee allow-list. Read from the DB (not the JWT) so a change by the
    // owner takes effect on the very next request. Owners are never restricted.
    if (user.role !== 'owner') {
      const row = await this.prisma.user.findUnique({
        where: { id: user.id },
        select: { restrictModules: true, moduleAccess: true },
      });
      if (row?.restrictModules && !row.moduleAccess.includes(moduleId)) {
        throw new ForbiddenError(`module_forbidden:${moduleId}`);
      }
    }

    return true;
  }
}
