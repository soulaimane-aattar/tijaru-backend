import { DomainError } from '../../../common/errors';
import type { PrismaService } from '../../../common/prisma.service';
import type { TenantContext } from '../../../common/tenant/tenant-context';

import { BusinessSettingsService } from './business-settings.service';

const BID = 'biz1';

const tenant = (): TenantContext => ({ getBusinessId: () => BID }) as unknown as TenantContext;

const makePrisma = (opts: {
  multiWarehouse?: boolean;
  enabledVatRates?: number[];
  businessMissing?: boolean;
}): PrismaService =>
  ({
    business: {
      findUnique: jest.fn().mockResolvedValue(
        opts.businessMissing
          ? null
          : {
              multiWarehouse: opts.multiWarehouse ?? true,
              enabledVatRates: opts.enabledVatRates ?? [0, 7, 10, 14, 20],
            },
      ),
    },
  }) as unknown as PrismaService;

describe('BusinessSettingsService (read-only; writes moved to platform admin)', () => {
  it('getMultiWarehouse returns current flag', async () => {
    const p = makePrisma({ multiWarehouse: false });
    const svc = new BusinessSettingsService(p, tenant());
    await expect(svc.getMultiWarehouse()).resolves.toEqual({ multiWarehouse: false });
  });

  it('getMultiWarehouse throws 404 when business missing', async () => {
    const p = makePrisma({ businessMissing: true });
    const svc = new BusinessSettingsService(p, tenant());
    await expect(svc.getMultiWarehouse()).rejects.toBeInstanceOf(DomainError);
  });

  it('getVatRates returns current + allowed', async () => {
    const p = makePrisma({ enabledVatRates: [0, 20] });
    const svc = new BusinessSettingsService(p, tenant());
    await expect(svc.getVatRates()).resolves.toEqual({
      enabledVatRates: [0, 20],
      allowed: [0, 7, 10, 14, 20],
    });
  });

  it('getVatRates throws 404 when business missing', async () => {
    const p = makePrisma({ businessMissing: true });
    const svc = new BusinessSettingsService(p, tenant());
    await expect(svc.getVatRates()).rejects.toBeInstanceOf(DomainError);
  });
});
