import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { from, lastValueFrom, type Observable } from 'rxjs';


import { Db } from '../../database/db.service';
import { SKIP_TENANT_TX_KEY } from '../decorators/skip-tenant-tx.decorator';

import { TenantContext } from './tenant-context';

@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(
    private readonly tenant: TenantContext,
    private readonly db: Db,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{ user?: { businessId?: string; sub?: string; id?: string; role?: string } }>();
    const u = req.user;
    if (!u?.businessId) return next.handle();
    const businessId = u.businessId;
    if (this.reflector.get<boolean | undefined>(SKIP_TENANT_TX_KEY, context.getHandler())) {
      return this.tenant.run(businessId, () => next.handle());
    }
    return this.tenant.run(businessId, () =>
      from(
        this.db.scope({ businessId, userId: u.sub ?? u.id, role: u.role }, () =>
          lastValueFrom(next.handle(), { defaultValue: undefined }),
        ),
      ),
    );
  }
}
