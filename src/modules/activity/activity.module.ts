import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { RequireCap } from '../../common/decorators/require-cap.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../common/prisma.service';

const ListQuerySchema = z.object({
  userId: z.string().cuid().optional(),
  action: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
type ListQuery = z.infer<typeof ListQuerySchema>;

@Injectable()
class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q: ListQuery): Promise<unknown> {
    const where: Record<string, unknown> = {};
    if (q.userId) where.userId = q.userId;
    if (q.action) where.action = q.action;
    if (q.from || q.to) {
      where.date = {};
      if (q.from) (where.date as { gte?: Date }).gte = q.from;
      if (q.to) (where.date as { lte?: Date }).lte = q.to;
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.activity.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, role: true } },
        },
        orderBy: { date: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.activity.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }
}

@ApiTags('activity')
@ApiBearerAuth()
@Controller({ path: 'activity', version: '1' })
class ActivityController {
  constructor(private readonly svc: ActivityService) {}

  @Get()
  @RequireCap('activity.view')
  list(@Query(new ZodValidationPipe(ListQuerySchema)) query: ListQuery): Promise<unknown> {
    return this.svc.list(query);
  }
}

@Module({
  controllers: [ActivityController],
  providers: [ActivityService, PrismaService],
})
export class ActivityModule {}
