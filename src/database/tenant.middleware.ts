import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { Kysely, sql } from 'kysely';

import { KYSELY } from './kysely.module';
import type { DB } from './types';

interface AuthenticatedRequest extends Request {
  user?: { businessId: string; sub?: string; id?: string; role?: string };
}

/**
 * Sets PG session variables for RLS before each request.
 * Uses set_config(..., false) = session-scoped (persists for the connection lifetime).
 * An afterResponse hook clears them so the pooled connection is clean for the next request.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(@Inject(KYSELY) private readonly db: Kysely<DB>) {}

  use(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    const user = req.user;
    if (!user?.businessId) {
      next();
      return;
    }

    const businessId = user.businessId;
    const userId = user.sub || user.id || '';
    const role = user.role || 'user';

    // Session-scoped (false) — persists on this connection until cleared.
    // We clear on response finish so the pooled connection is clean.
    sql`SELECT
      set_config('app.current_business_id', ${businessId}, false),
      set_config('app.current_user_id', ${userId}, false),
      set_config('app.current_user_role', ${role}, false)
    `
      .execute(this.db)
      .then(() => {
        res.on('finish', () => {
          sql`SELECT
            set_config('app.current_business_id', '', false),
            set_config('app.current_user_id', '', false),
            set_config('app.current_user_role', '', false)
          `
            .execute(this.db)
            .catch(() => {});
        });
        next();
      })
      .catch(next);
  }
}
