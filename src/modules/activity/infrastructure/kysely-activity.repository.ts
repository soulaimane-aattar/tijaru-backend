import { Injectable } from '@nestjs/common';

import { Db } from '../../../database';
import { camelRow } from '../../row-case';
import { ActivityRepository, type ActivitySearchCriteria } from '../domain/activity.repository';

@Injectable()
export class KyselyActivityRepository extends ActivityRepository {
  constructor(private readonly db: Db) {
    super();
  }

  async findPage(criteria: ActivitySearchCriteria): Promise<{ items: unknown[]; total: number }> {
    const filtered = this.db.q
      .selectFrom('app.activities as a')
      .where('a.business_id', '=', this.db.businessId)
      .$if(!!criteria.userId, (q) => q.where('a.userId', '=', criteria.userId as string))
      .$if(!!criteria.action, (q) => q.where('a.action', '=', criteria.action as string))
      .$if(!!criteria.from, (q) => q.where('a.date', '>=', criteria.from as Date))
      .$if(!!criteria.to, (q) => q.where('a.date', '<=', criteria.to as Date));

    const [rows, count] = await Promise.all([
      filtered
        .leftJoin('app_auth.users as u', 'u.id', 'a.userId')
        .selectAll('a')
        .select(['u.id as u_id', 'u.name as u_name', 'u.role as u_role'])
        .orderBy('a.date', 'desc')
        .offset(criteria.skip)
        .limit(criteria.take)
        .execute(),
      filtered.select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow(),
    ]);
    const items = rows.map(({ u_id, u_name, u_role, ...a }) => ({
      ...camelRow(a),
      user: u_id ? { id: u_id, name: u_name, role: u_role } : null,
    }));
    return { items, total: Number(count.n) };
  }
}
