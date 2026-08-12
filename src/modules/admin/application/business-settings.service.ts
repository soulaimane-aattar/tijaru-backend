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

  async setMultiWarehouse(enabled: boolean): Promise<{ multiWarehouse: boolean }> {
    const businessId = this.businessId();
    if (!enabled) {
      const count = await this.prisma.warehouse.count({
        where: { businessId, deletedAt: null },
      });
      if (count > 1) {
        throw new DomainError(
          'validation_error',
          `Cannot disable multi-warehouse: ${count} active warehouses exist. Remove extras first.`,
          400,
        );
      }
    }
    await this.prisma.business.update({
      where: { id: businessId },
      data: { multiWarehouse: enabled },
    });
    return { multiWarehouse: enabled };
  }

  async setVatRates(rates: number[]): Promise<{ enabledVatRates: number[]; allowed: readonly number[] }> {
    const invalid = rates.filter((r) => !ALLOWED_VAT.includes(r as (typeof ALLOWED_VAT)[number]));
    if (invalid.length) {
      throw new DomainError(
        'validation_error',
        `Invalid VAT rates: ${invalid.join(', ')}. Allowed: ${ALLOWED_VAT.join(', ')}`,
        400,
      );
    }
    if (rates.length === 0) {
      throw new DomainError('validation_error', 'At least one VAT rate required', 400);
    }
    const unique = Array.from(new Set(rates)).sort((a, b) => a - b);
    await this.prisma.business.update({
      where: { id: this.businessId() },
      data: { enabledVatRates: unique },
    });
    return { enabledVatRates: unique, allowed: ALLOWED_VAT };
  }
}
