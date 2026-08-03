import { Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../common/errors';
import { AdminSessionsRepository } from '../domain/admin-sessions.repository';

@Injectable()
export class AdminSessionsService {
  constructor(private readonly sessions: AdminSessionsRepository) {}

  list(): Promise<unknown> {
    return this.sessions.findActiveSessions();
  }

  async revoke(id: string): Promise<void> {
    if (!(await this.sessions.exists(id))) throw new NotFoundError('Session', id);
    await this.sessions.revoke(id);
  }

  async revokeAll(): Promise<{ revoked: number }> {
    const revoked = await this.sessions.revokeAllActive();
    return { revoked };
  }
}
