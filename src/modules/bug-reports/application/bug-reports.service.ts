import { Injectable } from '@nestjs/common';

import { ValidationError } from '../../../common/errors';
import { PrismaService } from '../../../common/prisma.service';
import { LocalStorageService } from '../../../common/storage/local-storage.service';
import type { CreateBugReportInput } from '../dto/bug-report.dto';

@Injectable()
export class BugReportsService {
  constructor(
    private readonly prisma: PrismaService,
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

    return this.prisma.bugReport.create({
      data: {
        businessId,
        userId,
        type: input.type ?? 'bug',
        description: input.description,
        screenshot: screenshot ?? null,
        pinX: input.pinX ?? null,
        pinY: input.pinY ?? null,
        screen: input.screen ?? null,
        deviceInfo: input.deviceInfo ?? null,
        appVersion: input.appVersion ?? null,
        note: input.note ?? null,
        ...(input.zone ? { zone: input.zone } : {}),
      },
    });
  }

  list(businessId: string) {
    return this.prisma.bugReport.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
  }
}
