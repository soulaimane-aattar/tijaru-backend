import { ConflictError, ValidationError } from '../../../common/errors';
import type { LedgerPost } from '../domain/stock-ledger.types';

import { StockLedgerService } from './stock-ledger.service';

type StockLevelRow = {
  productId: string;
  warehouseId: string;
  businessId: string;
  qty: number;
  reservedQty: number;
  avgCost: number;
  updatedAt: Date;
};

type MockPrisma = {
  stockLevel: {
    findUnique: jest.Mock;
    upsert: jest.Mock;
    updateMany: jest.Mock;
  };
  movement: { create: jest.Mock };
  $transaction: jest.Mock;
};

const mockPrisma = (): MockPrisma => ({
  stockLevel: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
    updateMany: jest.fn(),
  },
  movement: {
    create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'm1', ...data })),
  },
  $transaction: jest.fn(async (fn: (client: MockPrisma) => unknown) => fn(mockClientRef.current)),
});

// $transaction passthrough needs a reference to the same mock object it was created from.
const mockClientRef: { current: MockPrisma } = { current: undefined as unknown as MockPrisma };

const cuid = (i: number) => `c${'l'.repeat(23)}${i}`;
const PID = cuid(1);
const WH = cuid(2);
const WH2 = cuid(3);
const BID = 'biz1';
const UID = 'user1';

const basePost = (over: Partial<LedgerPost> = {}): LedgerPost => ({
  businessId: BID,
  userId: UID,
  type: 'in',
  reason: 'achat',
  lines: [{ productId: PID, warehouseId: WH, delta: 5 }],
  ...over,
});

const setup = () => {
  const prisma = mockPrisma();
  mockClientRef.current = prisma;
  const svc = new StockLedgerService(prisma as never);
  return { prisma, svc };
};

const stockRow = (over: Partial<StockLevelRow> = {}): StockLevelRow => ({
  productId: PID,
  warehouseId: WH,
  businessId: BID,
  qty: 0,
  reservedQty: 0,
  avgCost: 0,
  updatedAt: new Date(),
  ...over,
});

describe('StockLedgerService.post', () => {
  it('increments stock and emits Movement on type=in', async () => {
    const { prisma, svc } = setup();
    prisma.stockLevel.findUnique.mockResolvedValue(stockRow({ qty: 3, avgCost: 2 }));
    prisma.stockLevel.upsert.mockResolvedValue({});

    const result = await svc.post(
      basePost({ type: 'in', lines: [{ productId: PID, warehouseId: WH, delta: 5 }] }),
    );

    expect(prisma.stockLevel.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ qty: { increment: 5 } }) }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ productId: PID, warehouseId: WH, qty: 5, type: 'in' });
  });

  it('rejects out when qty < |delta| (conditional update returns 0)', async () => {
    const { prisma, svc } = setup();
    prisma.stockLevel.updateMany.mockResolvedValue({ count: 0 });

    const post = () =>
      svc.post(
        basePost({
          type: 'out',
          reason: 'vente',
          lines: [{ productId: PID, warehouseId: WH, delta: -2 }],
        }),
      );

    await expect(post()).rejects.toBeInstanceOf(ConflictError);
    await expect(post()).rejects.toMatchObject({
      response: expect.objectContaining({ title: 'insufficient_stock' }),
    });
  });

  it('creates stockLevel row when missing on positive delta', async () => {
    const { prisma, svc } = setup();
    prisma.stockLevel.findUnique.mockResolvedValue(null);
    prisma.stockLevel.upsert.mockResolvedValue({});

    await svc.post(
      basePost({ type: 'in', lines: [{ productId: PID, warehouseId: WH, delta: 4, unitCost: 3 }] }),
    );

    expect(prisma.stockLevel.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          productId: PID,
          warehouseId: WH,
          businessId: BID,
          qty: 4,
          avgCost: 3,
        }),
      }),
    );
  });

  it('for transfer: decrements from warehouse and increments toWarehouseId in same tx', async () => {
    const { prisma, svc } = setup();
    prisma.stockLevel.updateMany.mockResolvedValue({ count: 1 });
    prisma.stockLevel.findUnique.mockResolvedValue(stockRow({ warehouseId: WH2, qty: 0 }));
    prisma.stockLevel.upsert.mockResolvedValue({});

    const result = await svc.post(
      basePost({
        type: 'transfer',
        reason: 'transfert',
        toWarehouseId: WH2,
        lines: [{ productId: PID, warehouseId: WH, delta: -3 }],
      }),
    );

    expect(prisma.stockLevel.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ warehouseId: WH, qty: { gte: 3 } }),
      }),
    );
    expect(prisma.stockLevel.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ qty: { increment: 3 } }),
      }),
    );
    expect(result[0]).toMatchObject({ toWarehouseId: WH2 });
  });

  it('updates avgCost using weighted average on positive delta with unitCost', async () => {
    const { prisma, svc } = setup();
    prisma.stockLevel.findUnique.mockResolvedValue(stockRow({ qty: 10, avgCost: 5 }));
    prisma.stockLevel.upsert.mockResolvedValue({});

    await svc.post(
      basePost({
        type: 'in',
        lines: [{ productId: PID, warehouseId: WH, delta: 10, unitCost: 10 }],
      }),
    );

    expect(prisma.stockLevel.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ qty: { increment: 10 }, avgCost: 7.5 }),
      }),
    );
  });

  it('leaves avgCost untouched on negative delta', async () => {
    const { prisma, svc } = setup();
    prisma.stockLevel.updateMany.mockResolvedValue({ count: 1 });

    await svc.post(
      basePost({
        type: 'out',
        reason: 'vente',
        lines: [{ productId: PID, warehouseId: WH, delta: -2 }],
      }),
    );

    expect(prisma.stockLevel.upsert).not.toHaveBeenCalled();
    expect(prisma.stockLevel.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { qty: { decrement: 2 } } }),
    );
  });

  it('rejects transfer without toWarehouseId', async () => {
    const { svc } = setup();

    const post = () =>
      svc.post(
        basePost({
          type: 'transfer',
          reason: 'transfert',
          lines: [{ productId: PID, warehouseId: WH, delta: -5 }],
          // no toWarehouseId
        }),
      );

    await expect(post()).rejects.toBeInstanceOf(ValidationError);
    await expect(post()).rejects.toMatchObject({
      response: expect.objectContaining({ title: 'transfer_missing_destination' }),
    });
  });

  it('runs inside an outer tx when tx passed', async () => {
    const { prisma, svc } = setup();
    prisma.stockLevel.findUnique.mockResolvedValue(null);
    prisma.stockLevel.upsert.mockResolvedValue({});

    await svc.post(
      basePost({ lines: [{ productId: PID, warehouseId: WH, delta: 1 }] }),
      prisma as never,
    );

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.stockLevel.upsert).toHaveBeenCalledTimes(1);
  });
});
