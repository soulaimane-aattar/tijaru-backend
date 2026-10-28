import { Injectable } from '@nestjs/common';

import { DomainError, ValidationError } from '../../../common/errors';
import { LocalStorageService } from '../../../common/storage/local-storage.service';
import { TenantContext } from '../../../common/tenant/tenant-context';
import { Db } from '../../../database';

const ALLOWED_VAT = [0, 7, 10, 14, 20] as const;

@Injectable()
export class BusinessSettingsService {
  constructor(
    private readonly db: Db,
    private readonly tenant: TenantContext,
    private readonly storage: LocalStorageService,
  ) {}

  private businessId(): string {
    const id = this.tenant.getBusinessId();
    if (!id) throw new DomainError('unauthorized', 'No tenant in context', 401);
    return id;
  }

  private business<C extends 'enabled_vat_rates' | 'multi_warehouse' | 'logo'>(col: C) {
    return this.db.q
      .selectFrom('app.businesses')
      .select(col)
      .where('id', '=', this.businessId())
      .executeTakeFirst();
  }

  async getVatRates(): Promise<{ enabledVatRates: number[]; allowed: readonly number[] }> {
    const b = await this.business('enabled_vat_rates');
    if (!b) throw new DomainError('not_found', 'Business not found', 404);
    return { enabledVatRates: b.enabled_vat_rates, allowed: ALLOWED_VAT };
  }

  async listModules(): Promise<{ moduleId: string; active: boolean }[]> {
    const rows = await this.db.q
      .selectFrom('app.business_modules')
      .select(['module_id', 'active'])
      .where('business_id', '=', this.businessId())
      .execute();
    return rows.map((r) => ({ moduleId: r.module_id, active: r.active }));
  }

  async getMultiWarehouse(): Promise<{ multiWarehouse: boolean }> {
    const b = await this.business('multi_warehouse');
    if (!b) throw new DomainError('not_found', 'Business not found', 404);
    return { multiWarehouse: b.multi_warehouse };
  }

  async setMultiWarehouse(enabled: boolean): Promise<{ multiWarehouse: boolean }> {
    const b = await this.db.q
      .updateTable('app.businesses')
      .set({ multi_warehouse: enabled })
      .where('id', '=', this.businessId())
      .returning('multi_warehouse')
      .executeTakeFirstOrThrow();
    return { multiWarehouse: b.multi_warehouse };
  }

  async uploadLogo(buffer: Buffer): Promise<{ logoPath: string }> {
    const ext = this.storage.sniffExtension(buffer);
    if (!ext) throw new ValidationError('Unsupported image format');
    const bid = this.businessId();
    const logoPath = await this.storage.save('logos', bid, buffer, ext);
    const previous = (await this.business('logo'))?.logo;
    await this.setLogo(bid, logoPath);
    if (previous) await this.storage.remove(previous).catch(() => undefined);
    return { logoPath };
  }

  private async setLogo(bid: string, logo: string | null): Promise<void> {
    await this.db.q.updateTable('app.businesses').set({ logo }).where('id', '=', bid).execute();
  }

  async readLogo(): Promise<{ buffer: Buffer; ext: string }> {
    const b = await this.business('logo');
    if (!b?.logo) throw new DomainError('not_found', 'No logo uploaded', 404);
    const buffer = await this.storage.read(b.logo);
    const ext = b.logo.split('.').pop() ?? 'png';
    return { buffer, ext };
  }

  async removeLogo(): Promise<void> {
    const bid = this.businessId();
    const b = await this.business('logo');
    if (b?.logo) {
      await this.setLogo(bid, null);
      await this.storage.remove(b.logo).catch(() => undefined);
    }
  }
}
