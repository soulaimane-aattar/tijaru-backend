import { DomainError } from '../../../common/errors';
import type { PrismaService } from '../../../common/prisma.service';
import type { TenantContext } from '../../../common/tenant/tenant-context';

import { BusinessSettingsService } from './business-settings.service';

const BID = 'biz1';

const tenant = (): TenantContext => ({ getBusinessId: () => BID }) as unknown as TenantContext;

const makePrisma = (opts: {
  multiWarehouse?: boolean;
  warehouseCount?: number;
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
      update: jest.fn().mockResolvedValue(undefined),
    },
    warehouse: { count: jest.fn().mockResolvedValue(opts.warehouseCount ?? 0) },
  }) as unknown as PrismaService;

describe('BusinessSettingsService — multiWarehouse', () => {
  it('getMultiWarehouse returns current flag', async () => {
    const p = makePrisma({ multiWarehouse: false });
    const svc = new BusinessSettingsService(p, tenant());
    await expect(svc.getMultiWarehouse()).resolves.toEqual({ multiWarehouse: false });
  });

  it('enable always allowed', async () => {
    const p = makePrisma({ warehouseCount: 5 });
    const svc = new BusinessSettingsService(p, tenant());
    await expect(svc.setMultiWarehouse(true)).resolves.toEqual({ multiWarehouse: true });
    expect(p.warehouse.count).not.toHaveBeenCalled();
    expect(p.business.update).toHaveBeenCalledWith({
      where: { id: BID },
      data: { multiWarehouse: true },
    });
  });

  it('disable allowed when 0 or 1 warehouse exists', async () => {
    const p = makePrisma({ warehouseCount: 1 });
    const svc = new BusinessSettingsService(p, tenant());
    await expect(svc.setMultiWarehouse(false)).resolves.toEqual({ multiWarehouse: false });
    expect(p.business.update).toHaveBeenCalledTimes(1);
  });

  it('disable rejected when >1 active warehouses', async () => {
    const p = makePrisma({ warehouseCount: 3 });
    const svc = new BusinessSettingsService(p, tenant());
    await expect(svc.setMultiWarehouse(false)).rejects.toBeInstanceOf(DomainError);
    expect(p.business.update).not.toHaveBeenCalled();
  });

  it('getMultiWarehouse throws 404 when business missing', async () => {
    const p = makePrisma({ businessMissing: true });
    const svc = new BusinessSettingsService(p, tenant());
    await expect(svc.getMultiWarehouse()).rejects.toBeInstanceOf(DomainError);
  });
});

describe('BusinessSettingsService — VAT rates', () => {
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

  it('setVatRates persists sorted-deduped valid rates', async () => {
    const p = makePrisma({});
    const svc = new BusinessSettingsService(p, tenant());
    await expect(svc.setVatRates([20, 0, 10, 0, 20])).resolves.toEqual({
      enabledVatRates: [0, 10, 20],
      allowed: [0, 7, 10, 14, 20],
    });
    expect(p.business.update).toHaveBeenCalledWith({
      where: { id: BID },
      data: { enabledVatRates: [0, 10, 20] },
    });
  });

  it('setVatRates rejects invalid rate', async () => {
    const p = makePrisma({});
    const svc = new BusinessSettingsService(p, tenant());
    await expect(svc.setVatRates([0, 15])).rejects.toBeInstanceOf(DomainError);
    expect(p.business.update).not.toHaveBeenCalled();
  });

  it('setVatRates rejects empty array', async () => {
    const p = makePrisma({});
    const svc = new BusinessSettingsService(p, tenant());
    await expect(svc.setVatRates([])).rejects.toBeInstanceOf(DomainError);
    expect(p.business.update).not.toHaveBeenCalled();
  });

  it('setVatRates uses tenant businessId, not global', async () => {
    const p = makePrisma({});
    const svc = new BusinessSettingsService(p, tenant());
    await svc.setVatRates([0, 20]);
    expect(p.business.update).toHaveBeenCalledWith({
      where: { id: BID },
      data: { enabledVatRates: [0, 20] },
    });
  });
});
