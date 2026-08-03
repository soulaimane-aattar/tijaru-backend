import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma.service';
import { ActivityRepository, type ActivitySearchCriteria } from '../domain/activity.repository';

@Injectable()
export class PrismaActivityRepository extends ActivityRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findPage(
    criteria: ActivitySearchCriteria,
  ): Promise<{ items: unknown[]; total: number }> {
    const where: Prisma.ActivityWhereInput = {};
    if (criteria.userId) where.userId = criteria.userId;
    if (criteria.action) where.action = criteria.action;
    if (criteria.from || criteria.to) {
      where.date = {
        ...(criteria.from ? { gte: criteria.from } : {}),
        ...(criteria.to ? { lte: criteria.to } : {}),
      };
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.activity.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, role: true } },
        },
        orderBy: { date: 'desc' },
        skip: criteria.skip,
        take: criteria.take,
      }),
      this.prisma.activity.count({ where }),
    ]);
    return { items, total };
  }
}
