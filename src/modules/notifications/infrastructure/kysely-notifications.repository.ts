
import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { NotFoundError } from '../../../common/errors';
import { Db } from '../../../database';
import { newId } from '../../../database/ids';
import type { AppNotificationtype } from '../../../database/types';
import { camelRow } from '../../row-case';
import {
  type CreateNotificationInput,
  type ExpiringCandidate,
  type LowStockCandidate,
  NotificationsRepository,
} from '../domain/notifications.repository';

/**
 * Inbox methods run in the request's tenant scope (`db.q`). The scanner methods are the daily cron:
 * no tenant, deliberately cross-business, so they use the owner pool and carry `businessId` explicitly.
 */
@Injectable()
export class KyselyNotificationsRepository extends NotificationsRepository {
  constructor(private readonly db: Db) {
    super();
  }

  async findRecent(): Promise<unknown[]> {
    const rows = await this.db.q
      .selectFrom('app.notifications')
      .selectAll()
      .where('business_id', '=', this.db.businessId)
      .orderBy('date', 'desc')
      .limit(100)
      .execute();
    return rows.map(camelRow);
  }

  async countUnread(): Promise<number> {
    const r = await this.db.q
      .selectFrom('app.notifications')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('business_id', '=', this.db.businessId)
      .where('read', '=', false)
      .executeTakeFirstOrThrow();
    return Number(r.n);
  }

  async markRead(id: string): Promise<unknown> {
    const row = await this.db.q
      .updateTable('app.notifications')
      .set({ read: true })
      .where('business_id', '=', this.db.businessId)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw new NotFoundError('Notification', id);
    return camelRow(row);
  }

  async markAllUnreadRead(): Promise<number> {
    const r = await this.db.q
      .updateTable('app.notifications')
      .set({ read: true })
      .where('business_id', '=', this.db.businessId)
      .where('read', '=', false)
      .executeTakeFirst();
    return Number(r.numUpdatedRows);
  }

  async findLowStockCandidates(): Promise<LowStockCandidate[]> {
    const { rows } = await sql<LowStockCandidate>`
      SELECT p.business_id AS "businessId", p.id AS "productId", p.name AS "productName",
             COALESCE(SUM(sl.qty), 0)::int AS "totalQty", p."minStock" AS "minStock"
      FROM app.products p
      LEFT JOIN app.stock_levels sl ON sl."productId" = p.id
      WHERE p."deletedAt" IS NULL AND p."minStock" > 0
      GROUP BY p.business_id, p.id, p.name, p."minStock"
      HAVING COALESCE(SUM(sl.qty), 0) < p."minStock"
    `.execute(this.db.admin);
    return rows;
  }

  async findExpiringCandidates(daysWindow: number): Promise<ExpiringCandidate[]> {
    const cutoff = new Date(Date.now() + daysWindow * 86400000);
    const rows = await this.db.admin
      .selectFrom('app.products')
      .select(['business_id', 'id', 'name', 'expiry'])
      .where('deletedAt', 'is', null)
      .where('trackExpiry', '=', true)
      .where('expiry', '>', new Date())
      .where('expiry', '<=', cutoff)
      .execute();
    return rows.map((r) => ({ businessId: r.business_id, id: r.id, name: r.name, expiry: r.expiry as Date }));
  }

  async existsUnread(businessId: string, type: AppNotificationtype, body: string): Promise<boolean> {
    const found = await this.db.admin
      .selectFrom('app.notifications')
      .select('id')
      .where('business_id', '=', businessId)
      .where('type', '=', type)
      .where('body', '=', body)
      .where('read', '=', false)
      .executeTakeFirst();
    return found !== undefined;
  }

  async create(input: CreateNotificationInput): Promise<unknown> {
    const row = await this.db.admin
      .insertInto('app.notifications')
      .values({ id: newId(), business_id: input.businessId, type: input.type, title: input.title, body: input.body })
      .returningAll()
      .executeTakeFirstOrThrow();
    return camelRow(row);
  }
}
