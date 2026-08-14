import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma.service';
import { BusinessInfoLookup, type BusinessInfo } from '../domain/business-info.lookup';

/** Prisma-backed lookup for the business letterhead on the expense report PDF. */
@Injectable()
export class PrismaBusinessInfoLookup extends BusinessInfoLookup {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async get(businessId: string): Promise<BusinessInfo | null> {
    const b = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { name: true, address: true, ice: true, phone: true },
    });
    return b ?? null;
  }
}
