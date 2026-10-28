import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { Db } from '../../database';
import type { AuthUser } from '../auth/auth-user.type';
import { ENFORCE_LIMIT_KEY, type LimitResource } from '../decorators/enforce-limit.decorator';
import { ForbiddenError } from '../errors';

@Injectable()
export class LimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: Db,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const resource = this.reflector.get<LimitResource | undefined>(
      ENFORCE_LIMIT_KEY,
      context.getHandler(),
    );
    if (!resource) return true;

    const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user || user.isSuperAdmin) return true;

    // Guards run before the tenant transaction exists → owner pool, explicit id filters.
    const business = await this.db.admin
      .selectFrom('app.businesses')
      .select(['max_users', 'max_products', 'max_warehouses'])
      .where('id', '=', user.businessId)
      .executeTakeFirst();
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
    business: { max_users: number; max_products: number; max_warehouses: number },
  ): number {
    switch (resource) {
      case 'users':
        return business.max_users;
      case 'products':
        return business.max_products;
      case 'warehouses':
        return business.max_warehouses;
    }
  }

  private async countResource(resource: LimitResource, businessId: string): Promise<number> {
    const table = { users: 'app_auth.users', products: 'app.products', warehouses: 'app.warehouses' } as const;
    const r = await this.db.admin
      .selectFrom(table[resource])
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('business_id', '=', businessId)
      .where('deletedAt', 'is', null)
      .executeTakeFirstOrThrow();
    return Number(r.n);
  }
}
