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

    return true;
  }
}
