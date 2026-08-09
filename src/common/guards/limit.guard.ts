import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { AuthUser } from '../auth/auth-user.type';
import { ENFORCE_LIMIT_KEY, type LimitResource } from '../decorators/enforce-limit.decorator';
import { ForbiddenError } from '../errors';
import { PrismaService } from '../prisma.service';

@Injectable()
export class LimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const resource = this.reflector.get<LimitResource | undefined>(
      ENFORCE_LIMIT_KEY,
      context.getHandler(),
    );
    if (!resource) return true;

    const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user || user.isSuperAdmin) return true;

    const business = await this.prisma.business.findUnique({
      where: { id: user.businessId },
      select: { maxUsers: true, maxProducts: true, maxWarehouses: true },
    });
    if (!business) return true;

    const max = this.maxFor(resource, business);
    const current = await this.countResource(resource, user.businessId);

    if (current >= max) {
      throw new ForbiddenError(`limit_reached:${resource}`);
    }

    return true;
  }

  private maxFor(
    resource: LimitResource,
    business: { maxUsers: number; maxProducts: number; maxWarehouses: number },
  ): number {
    switch (resource) {
      case 'users':
        return business.maxUsers;
      case 'products':
        return business.maxProducts;
      case 'warehouses':
        return business.maxWarehouses;
    }
  }

  private countResource(resource: LimitResource, businessId: string): Promise<number> {
    switch (resource) {
      case 'users':
        return this.prisma.user.count({ where: { businessId, deletedAt: null } });
      case 'products':
        return this.prisma.product.count({ where: { businessId, deletedAt: null } });
      case 'warehouses':
        return this.prisma.warehouse.count({ where: { businessId, deletedAt: null } });
    }
  }
}
