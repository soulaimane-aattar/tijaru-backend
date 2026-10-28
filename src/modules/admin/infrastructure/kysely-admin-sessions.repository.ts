import { Injectable } from '@nestjs/common';

import { Db } from '../../../database';
import { AdminSessionsRepository } from '../domain/admin-sessions.repository';

/** Scoped to the caller's business (the Prisma version listed/revoked sessions of every tenant). */
@Injectable()
export class KyselyAdminSessionsRepository extends AdminSessionsRepository {
  constructor(private readonly db: Db) {
    super();
  }

  async findActiveSessions(): Promise<unknown> {
    const rows = await this.db.q
      .selectFrom('app_auth.sessions as s')
      .innerJoin('app_auth.users as u', 'u.id', 's.userId')
      .selectAll('s')
      .select(['u.name as user_name', 'u.email as user_email', 'u.role as user_role'])
      .where('s.business_id', '=', this.db.businessId)
      .where('s.revokedAt', 'is', null)
      .where('s.expiresAt', '>', new Date())
      .orderBy('s.lastSeenAt', 'desc')
      .execute();
    return rows.map(({ user_name, user_email, user_role, ...s }) => ({
      ...s,
      user: { id: s.userId, name: user_name, email: user_email, role: user_role },
    }));
  }

  async exists(id: string): Promise<boolean> {
    const s = await this.db.q
      .selectFrom('app_auth.sessions')
      .select('id')
      .where('business_id', '=', this.db.businessId)
      .where('id', '=', id)
      .executeTakeFirst();
    return s !== undefined;
  }

  async revoke(id: string): Promise<void> {
    await this.db.q
      .updateTable('app_auth.sessions')
      .set({ revokedAt: new Date() })
      .where('business_id', '=', this.db.businessId)
      .where('id', '=', id)
      .execute();
  }

  async revokeAllActive(): Promise<number> {
    const r = await this.db.q
      .updateTable('app_auth.sessions')
      .set({ revokedAt: new Date() })
      .where('business_id', '=', this.db.businessId)
      .where('revokedAt', 'is', null)
      .executeTakeFirst();
    return Number(r.numUpdatedRows);
  }
}
