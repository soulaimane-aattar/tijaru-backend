import { Injectable } from '@nestjs/common';

import { DomainError, ValidationError } from '../../../common/errors';
import { PrismaService } from '../../../common/prisma.service';
import { LocalStorageService } from '../../../common/storage/local-storage.service';
import { TenantContext } from '../../../common/tenant/tenant-context';

const ALLOWED_VAT = [0, 7, 10, 14, 20] as const;

@Injectable()
export class BusinessSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
    private readonly storage: LocalStorageService,
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

  async uploadLogo(buffer: Buffer): Promise<{ logoPath: string }> {
    const ext = this.storage.sniffExtension(buffer);
    if (!ext) throw new ValidationError('Unsupported image format');
    const bid = this.businessId();
    const logoPath = await this.storage.save('logos', bid, buffer, ext);
    const previous = await this.prisma.business
      .findUnique({ where: { id: bid }, select: { logo: true } })
      .then((b) => b?.logo);
    await this.prisma.business.update({ where: { id: bid }, data: { logo: logoPath } });
    if (previous) await this.storage.remove(previous).catch(() => undefined);
    return { logoPath };
  }

  async readLogo(): Promise<{ buffer: Buffer; ext: string }> {
    const b = await this.prisma.business.findUnique({
      where: { id: this.businessId() },
      select: { logo: true },
    });
    if (!b?.logo) throw new DomainError('not_found', 'No logo uploaded', 404);
    const buffer = await this.storage.read(b.logo);
    const ext = b.logo.split('.').pop() ?? 'png';
    return { buffer, ext };
  }

  async removeLogo(): Promise<void> {
    const bid = this.businessId();
    const b = await this.prisma.business.findUnique({
      where: { id: bid },
      select: { logo: true },
    });
    if (b?.logo) {
      await this.prisma.business.update({ where: { id: bid }, data: { logo: null } });
      await this.storage.remove(b.logo).catch(() => undefined);
    }
  }
}
