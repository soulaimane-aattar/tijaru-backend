import { Injectable } from '@nestjs/common';

import { ActivityRepository } from '../domain/activity.repository';
import type { ListActivityQuery } from '../dto/activity.dto';

@Injectable()
export class ActivityService {
  constructor(private readonly activity: ActivityRepository) {}

  async list(q: ListActivityQuery): Promise<unknown> {
    const { items, total } = await this.activity.findPage({
      userId: q.userId,
      action: q.action,
      from: q.from,
      to: q.to,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    });
    return { items, total, page: q.page, pageSize: q.pageSize };
  }
}
