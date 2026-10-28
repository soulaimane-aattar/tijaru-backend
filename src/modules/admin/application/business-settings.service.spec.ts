import { DomainError } from '../../../common/errors';
import type { LocalStorageService } from '../../../common/storage/local-storage.service';
import type { TenantContext } from '../../../common/tenant/tenant-context';
import { fakeDb } from '../../../common/testing/db-fake';

import { BusinessSettingsService } from './business-settings.service';

const BID = 'biz1';

const tenant = (): TenantContext => ({ getBusinessId: () => BID }) as unknown as TenantContext;
const storage = () => ({}) as unknown as LocalStorageService;

const makeDb = (opts: {
  multiWarehouse?: boolean;
  enabledVatRates?: number[];
  businessMissing?: boolean;
}) =>
  fakeDb({
    'select:app.businesses': opts.businessMissing
      ? undefined
      : {
          multi_warehouse: opts.multiWarehouse ?? true,
          enabled_vat_rates: opts.enabledVatRates ?? [0, 7, 10, 14, 20],
        },
  }).db;

describe('BusinessSettingsService (read-only; writes moved to platform admin)', () => {
  it('getMultiWarehouse returns current flag', async () => {
    const p = makeDb({ multiWarehouse: false });
    const svc = new BusinessSettingsService(p, tenant(), storage());
    await expect(svc.getMultiWarehouse()).resolves.toEqual({ multiWarehouse: false });
  });

  it('getMultiWarehouse throws 404 when business missing', async () => {
    const p = makeDb({ businessMissing: true });
    const svc = new BusinessSettingsService(p, tenant(), storage());
    await expect(svc.getMultiWarehouse()).rejects.toBeInstanceOf(DomainError);
  });

  it('getVatRates returns current + allowed', async () => {
    const p = makeDb({ enabledVatRates: [0, 20] });
    const svc = new BusinessSettingsService(p, tenant(), storage());
    await expect(svc.getVatRates()).resolves.toEqual({
      enabledVatRates: [0, 20],
      allowed: [0, 7, 10, 14, 20],
    });
  });

  it('getVatRates throws 404 when business missing', async () => {
    const p = makeDb({ businessMissing: true });
    const svc = new BusinessSettingsService(p, tenant(), storage());
    await expect(svc.getVatRates()).rejects.toBeInstanceOf(DomainError);
  });
});
