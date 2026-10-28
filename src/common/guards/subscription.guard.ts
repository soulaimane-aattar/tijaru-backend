import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { Db } from '../../database';
import type { AuthUser } from '../auth/auth-user.type';
import { BusinessSuspendedError, ForbiddenError, SubscriptionExpiredError } from '../errors';

import { IS_PUBLIC_KEY } from './jwt.guard';

@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: Db,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user || user.isSuperAdmin) return true;
    if (!user.businessId) return true;

    // Guards run before the tenant transaction exists → owner pool, explicit id filter.
    const business = await this.db.admin
      .selectFrom('app.businesses')
      .select(['plan', 'subscription_end'])
      .where('id', '=', user.businessId)
      .executeTakeFirst();

    if (!business) throw new ForbiddenError('Business not found');

    if (business.subscription_end && business.subscription_end < new Date()) {
      if (business.plan === 'active') {
        await this.db.admin
          .updateTable('app.businesses')
          .set({ plan: 'expired' })
          .where('id', '=', user.businessId)
          .execute();
      }
      throw new SubscriptionExpiredError();
    }

    if (business.plan === 'suspended') {
      throw new BusinessSuspendedError();
    }

    return true;
  }
}
