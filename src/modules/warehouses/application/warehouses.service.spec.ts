import { ConflictError, ForbiddenError } from '../../../common/errors';
import type { PrismaService } from '../../../common/prisma.service';
import type { TenantContext } from '../../../common/tenant/tenant-context';
import type { WarehousesRepository } from '../domain/warehouses.repository';
import type { CreateWarehouseInput } from '../dto/warehouse.dto';

import { WarehousesService } from './warehouses.service';

const BID = 'biz1';

const repo = (over: Partial<jest.Mocked<WarehousesRepository>> = {}): jest.Mocked<WarehousesRepository> =>
  ({
    findAll: jest.fn(),
    findDetail: jest.fn(),
    exists: jest.fn().mockResolvedValue(true),
    countActive: jest.fn().mockResolvedValue(0),
    countNonZeroStock: jest.fn().mockResolvedValue(0),
    create: jest.fn().mockResolvedValue({ id: 'wh1' }),
    update: jest.fn(),
    softDelete: jest.fn(),
    ...over,
  }) as unknown as jest.Mocked<WarehousesRepository>;

const tenant = (id: string | undefined): TenantContext =>
  ({ getBusinessId: () => id }) as unknown as TenantContext;

const prisma = (multiWarehouse: boolean): PrismaService =>
  ({
    business: { findUnique: jest.fn().mockResolvedValue({ multiWarehouse }) },
  }) as unknown as PrismaService;

const input: CreateWarehouseInput = {
  name: 'Main',
  city: 'Casablanca',
  active: true,
  isDefault: true,
} as CreateWarehouseInput;

describe('WarehousesService.create — multi-warehouse gating', () => {
  it('allows create when multiWarehouse=true regardless of count', async () => {
    const r = repo({ countActive: jest.fn().mockResolvedValue(5) as never });
    const svc = new WarehousesService(r, prisma(true), tenant(BID));
    await expect(svc.create(input)).resolves.toEqual({ id: 'wh1' });
    expect(r.create).toHaveBeenCalledTimes(1);
  });

  it('allows first warehouse when multiWarehouse=false', async () => {
    const r = repo({ countActive: jest.fn().mockResolvedValue(0) as never });
    const svc = new WarehousesService(r, prisma(false), tenant(BID));
    await expect(svc.create(input)).resolves.toEqual({ id: 'wh1' });
    expect(r.create).toHaveBeenCalledTimes(1);
  });

  it('rejects second warehouse when multiWarehouse=false', async () => {
    const r = repo({ countActive: jest.fn().mockResolvedValue(1) as never });
    const svc = new WarehousesService(r, prisma(false), tenant(BID));
    await expect(svc.create(input)).rejects.toBeInstanceOf(ForbiddenError);
    expect(r.create).not.toHaveBeenCalled();
  });

  it('skips gating when tenant context missing', async () => {
    const r = repo();
    const p = prisma(false);
    const svc = new WarehousesService(r, p, tenant(undefined));
    await svc.create(input);
    expect(p.business.findUnique).not.toHaveBeenCalled();
    expect(r.create).toHaveBeenCalledTimes(1);
  });
});

describe('WarehousesService.remove — non-empty warehouse guard', () => {
  it('delete rejects when any stock level qty > 0 in the warehouse', async () => {
    const r = repo({ countNonZeroStock: jest.fn().mockResolvedValue(1) as never });
    const svc = new WarehousesService(r, prisma(true), tenant(BID));
    await expect(svc.remove('wh1')).rejects.toBeInstanceOf(ConflictError);
    expect(r.softDelete).not.toHaveBeenCalled();
  });

  it('delete succeeds when all stock levels are zero', async () => {
    const r = repo({ countNonZeroStock: jest.fn().mockResolvedValue(0) as never });
    const svc = new WarehousesService(r, prisma(true), tenant(BID));
    await expect(svc.remove('wh1')).resolves.toBeUndefined();
    expect(r.softDelete).toHaveBeenCalledWith('wh1');
  });
});
