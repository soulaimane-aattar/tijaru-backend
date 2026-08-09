import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { AuthUser } from '../auth/auth-user.type';
import { BusinessSuspendedError, ForbiddenError, SubscriptionExpiredError } from '../errors';
import { PrismaService } from '../prisma.service';
import { IS_PUBLIC_KEY } from './jwt.guard';

@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
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

    const business = await this.prisma.business.findUnique({
      where: { id: user.businessId },
      select: { plan: true, subscriptionEnd: true },
    });

    if (!business) throw new ForbiddenError('Business not found');

    if (business.subscriptionEnd && business.subscriptionEnd < new Date()) {
      if (business.plan === 'active') {
        await this.prisma.business.update({
          where: { id: user.businessId },
          data: { plan: 'expired' },
        });
      }
      throw new SubscriptionExpiredError();
    }

    if (business.plan === 'suspended') {
      throw new BusinessSuspendedError();
    }

    return true;
  }
}
