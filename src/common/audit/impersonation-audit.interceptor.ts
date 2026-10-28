
import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { type Observable, tap } from 'rxjs';

import { Db } from '../../database';
import { newId } from '../../database/ids';
import type { AuthUser } from '../auth/auth-user.type';

const READ_ONLY = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Every write a super admin makes through an impersonation token lands in the platform journal. */
@Injectable()
export class ImpersonationAuditInterceptor implements NestInterceptor {
  constructor(private readonly db: Db) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = req.user;
    if (!user?.impersonatedBy || READ_ONLY.has(req.method)) return next.handle();

    return next.handle().pipe(
      tap(() => {
        void this.db.admin
          .insertInto('platform_audit_logs')
          .values({
            id: newId(),
            action: 'impersonated-write',
            tone: 'warn',
            target_type: 'business',
            target_id: user.businessId,
            target_name: `${req.method} ${req.route?.path ?? req.path}`,
            detail: `admin ${user.impersonatedBy} as ${user.role} ${user.id}`,
          })
          .execute()
          .catch(() => undefined); // journal is best-effort
      }),
    );
  }
}
