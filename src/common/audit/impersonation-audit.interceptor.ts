import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { type Observable, tap } from 'rxjs';

import type { AuthUser } from '../auth/auth-user.type';
import { PrismaService } from '../prisma.service';

const READ_ONLY = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Every write a super admin makes through an impersonation token lands in the platform journal. */
@Injectable()
export class ImpersonationAuditInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = req.user;
    if (!user?.impersonatedBy || READ_ONLY.has(req.method)) return next.handle();

    return next.handle().pipe(
      tap(() => {
        void this.prisma.platformAuditLog
          .create({
            data: {
              action: 'impersonated-write',
              tone: 'warn',
              targetType: 'business',
              targetId: user.businessId,
              targetName: `${req.method} ${req.route?.path ?? req.path}`,
              detail: `admin ${user.impersonatedBy} as ${user.role} ${user.id}`,
            },
          })
          .catch(() => undefined); // journal is best-effort
      }),
    );
  }
}
