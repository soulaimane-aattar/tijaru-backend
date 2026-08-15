import { Injectable } from '@nestjs/common';

import { DomainError } from '../../../common/errors';
import { PrismaService } from '../../../common/prisma.service';
import { TenantContext } from '../../../common/tenant/tenant-context';

const ALLOWED_VAT = [0, 7, 10, 14, 20] as const;

@Injectable()
export class BusinessSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
  ) {}

  private businessId(): string {
    const id = this.tenant.getBusinessId();
    if (!id) throw new DomainError('unauthorized', 'No tenant in context', 401);
    return id;
  }

  async getVatRates(): Promise<{ enabledVatRates: number[]; allowed: readonly number[] }> {
    const b = await this.prisma.business.findUnique({
      where: { id: this.businessId() },
      select: { enabledVatRates: true },
    });
    if (!b) throw new DomainError('not_found', 'Business not found', 404);
    return { enabledVatRates: b.enabledVatRates, allowed: ALLOWED_VAT };
  }

  async getMultiWarehouse(): Promise<{ multiWarehouse: boolean }> {
    const b = await this.prisma.business.findUnique({
      where: { id: this.businessId() },
      select: { multiWarehouse: true },
    });
    if (!b) throw new DomainError('not_found', 'Business not found', 404);
    return { multiWarehouse: b.multiWarehouse };
  }

}
