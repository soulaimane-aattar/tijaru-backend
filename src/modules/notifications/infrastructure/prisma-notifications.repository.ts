import { Injectable } from '@nestjs/common';
import type { NotificationType } from '@prisma/client';

import { PrismaService } from '../../../common/prisma.service';
import {
  type CreateNotificationInput,
  type ExpiringCandidate,
  type LowStockCandidate,
  NotificationsRepository,
} from '../domain/notifications.repository';

@Injectable()
export class PrismaNotificationsRepository extends NotificationsRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  findRecent(): Promise<unknown[]> {
    return this.prisma.notification.findMany({ orderBy: { date: 'desc' }, take: 100 });
  }

  countUnread(): Promise<number> {
    return this.prisma.notification.count({ where: { read: false } });
  }

  markRead(id: string): Promise<unknown> {
    return this.prisma.notification.update({ where: { id }, data: { read: true } });
  }

  async markAllUnreadRead(): Promise<number> {
    const r = await this.prisma.notification.updateMany({
      where: { read: false },
      data: { read: true },
    });
    return r.count;
  }

  findLowStockCandidates(): Promise<LowStockCandidate[]> {
    return this.prisma.$queryRaw<LowStockCandidate[]>`
      SELECT p.business_id AS "businessId", p.id AS "productId", p.name AS "productName",
             COALESCE(SUM(sl.qty), 0)::int AS "totalQty", p."minStock" AS "minStock"
      FROM products p
      LEFT JOIN stock_levels sl ON sl."productId" = p.id
      WHERE p."deletedAt" IS NULL AND p."minStock" > 0
      GROUP BY p.business_id, p.id, p.name, p."minStock"
      HAVING COALESCE(SUM(sl.qty), 0) < p."minStock"
    `;
  }

  findExpiringCandidates(daysWindow: number): Promise<ExpiringCandidate[]> {
    const cutoff = new Date(Date.now() + daysWindow * 86400000);
    return this.prisma.product.findMany({
      where: {
        deletedAt: null,
        trackExpiry: true,
        expiry: { gt: new Date(), lte: cutoff },
      },
      select: { businessId: true, id: true, name: true, expiry: true },
    }) as unknown as Promise<ExpiringCandidate[]>;
  }

  async existsUnread(businessId: string, type: NotificationType, body: string): Promise<boolean> {
    const found = await this.prisma.notification.findFirst({
      where: { businessId, type, body, read: false },
      select: { id: true },
    });
    return found !== null;
  }

  create(input: CreateNotificationInput): Promise<unknown> {
    return this.prisma.notification.create({ data: input });
  }
}
