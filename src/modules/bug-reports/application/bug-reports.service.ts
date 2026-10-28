
import { Injectable } from '@nestjs/common';

import { ValidationError } from '../../../common/errors';
import { LocalStorageService } from '../../../common/storage/local-storage.service';
import { Db } from '../../../database';
import { newId } from '../../../database/ids';
import { camelRow } from '../../row-case';
import type { CreateBugReportInput } from '../dto/bug-report.dto';

@Injectable()
export class BugReportsService {
  constructor(
    private readonly db: Db,
    private readonly storage: LocalStorageService,
  ) {}

  async create(
    input: CreateBugReportInput,
    file: Buffer | undefined,
    businessId: string,
    userId: string,
  ) {
    let screenshot: string | undefined;
    if (file) {
      // Declared mimetype is client-controlled; only trust the magic bytes.
      const ext = this.storage.sniffExtension(file);
      if (!ext) throw new ValidationError('screenshot must be a PNG, JPEG or WebP image');
      screenshot = await this.storage.save('bug-reports', businessId, file, ext);
    }

    const row = await this.db.q
      .insertInto('app.bug_reports')
      .values({
        id: newId(),
        business_id: businessId,
        user_id: userId,
        type: input.type ?? 'bug',
        description: input.description,
        screenshot: screenshot ?? null,
        pin_x: input.pinX ?? null,
        pin_y: input.pinY ?? null,
        screen: input.screen ?? null,
        device_info: input.deviceInfo ?? null,
        app_version: input.appVersion ?? null,
        note: input.note ?? null,
        ...(input.zone ? { zone: JSON.stringify(input.zone) } : {}),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return camelRow(row);
  }

  async list(businessId: string) {
    const rows = await this.db.q
      .selectFrom('app.bug_reports as b')
      .leftJoin('app_auth.users as u', 'u.id', 'b.user_id')
      .selectAll('b')
      .select(['u.id as u_id', 'u.name as u_name', 'u.email as u_email'])
      .where('b.business_id', '=', businessId)
      .orderBy('b.created_at', 'desc')
      .execute();
    return rows.map(({ u_id, u_name, u_email, ...b }) => ({
      ...camelRow(b),
      user: u_id ? { id: u_id, name: u_name, email: u_email } : null,
    }));
  }
}
