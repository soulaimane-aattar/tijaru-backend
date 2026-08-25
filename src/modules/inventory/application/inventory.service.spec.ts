import { ConflictError, NotFoundError } from '../../../common/errors';
import type { PrismaService } from '../../../common/prisma.service';
import type { StockLedgerService } from '../../stock-ledger/application/stock-ledger.service';
import type { InventoryCountView } from '../domain/inventory.repository';
import type { InventoryRepository } from '../domain/inventory.repository';
import type { ApplyCountInput } from '../dto/inventory.dto';

import { InventoryService } from './inventory.service';

const cuid = (i: number) => `c${'l'.repeat(23)}${i}`;
const PID = cuid(1);
const PID2 = cuid(2);
const WH = cuid(3);
const COUNT_ID = cuid(4);
const LINE_ID = cuid(5);

const actor = {
  id: 'user1',
  businessId: 'biz1',
  role: 'owner' as const,
  tokenVersion: 1,
  roleCaps: [] as never[],
  overrides: {},
};

const baseCount = (over: Partial<InventoryCountView> = {}): InventoryCountView => ({
  id: COUNT_ID,
  warehouseId: WH,
  appliedAt: null,
  lines: [{ id: LINE_ID, productId: PID, expected: 10, counted: 10 }],
  ...over,
});

const mockRepo = (): jest.Mocked<InventoryRepository> =>
  ({
    findAll: jest.fn(),
    findDetail: jest.fn().mockResolvedValue({ id: COUNT_ID }),
    warehouseExists: jest.fn(),
    findActiveStockLevels: jest.fn(),
    createCount: jest.fn(),
    findWithLines: jest.fn().mockResolvedValue(baseCount()),
    findLiveStockLevels: jest.fn().mockResolvedValue([{ productId: PID, qty: 7 }]),
    updateLineCounted: jest.fn().mockResolvedValue(undefined),
    markApplied: jest.fn().mockResolvedValue(undefined),
    logActivity: jest.fn().mockResolvedValue(undefined),
  }) as unknown as jest.Mocked<InventoryRepository>;

const mockLedger = (): jest.Mocked<StockLedgerService> =>
  ({
    post: jest.fn().mockResolvedValue([{ id: 'm1' }]),
  }) as unknown as jest.Mocked<StockLedgerService>;

/** A fake `tx` handle that's distinguishable by identity from `prisma` itself. */
const FAKE_TX = { __tx: true } as never;

const mockPrisma = (): jest.Mocked<PrismaService> =>
  ({
    $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(FAKE_TX)),
  }) as unknown as jest.Mocked<PrismaService>;

const applyInput = (counted: number, productId = PID): ApplyCountInput => ({
  lines: [{ productId, counted }],
});

describe('InventoryService.apply', () => {
  it('computes delta = counted - liveQty (not counted - expected) and posts ledger', async () => {
    // count snapshotted expected=10; live qty now 7 (3 sold after start); counted=9
    // → delta = +2 (not -1)
    const repo = mockRepo();
    repo.findWithLines.mockResolvedValue(
      baseCount({ lines: [{ id: LINE_ID, productId: PID, expected: 10, counted: 10 }] }),
    );
    repo.findLiveStockLevels.mockResolvedValue([{ productId: PID, qty: 7 }]);
    const ledger = mockLedger();
    const prisma = mockPrisma();
    const svc = new InventoryService(repo, ledger, prisma);

    await svc.apply(COUNT_ID, applyInput(9), actor);

    expect(ledger.post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'in',
        reason: 'ajustement',
        lines: [expect.objectContaining({ productId: PID, warehouseId: WH, delta: 2 })],
      }),
      FAKE_TX,
    );
    expect(repo.markApplied).toHaveBeenCalledWith(COUNT_ID, FAKE_TX);
  });

  it('splits mixed deltas into a positive (in) and negative (out) ledger post', async () => {
    const repo = mockRepo();
    repo.findWithLines.mockResolvedValue(
      baseCount({
        lines: [
          { id: LINE_ID, productId: PID, expected: 10, counted: 10 },
          { id: cuid(6), productId: PID2, expected: 5, counted: 5 },
        ],
      }),
    );
    repo.findLiveStockLevels.mockResolvedValue([
      { productId: PID, qty: 7 },
      { productId: PID2, qty: 5 },
    ]);
    const ledger = mockLedger();
    const prisma = mockPrisma();
    const svc = new InventoryService(repo, ledger, prisma);

    await svc.apply(
      COUNT_ID,
      { lines: [{ productId: PID, counted: 9 }, { productId: PID2, counted: 2 }] },
      actor,
    );

    expect(ledger.post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'in',
        lines: [expect.objectContaining({ productId: PID, delta: 2 })],
      }),
      FAKE_TX,
    );
    expect(ledger.post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'out',
        lines: [expect.objectContaining({ productId: PID2, delta: -3 })],
      }),
      FAKE_TX,
    );
  });

  it('is idempotent — second apply on an already-applied count rejects with count_already_applied', async () => {
    const repo = mockRepo();
    repo.findWithLines.mockResolvedValue(baseCount({ appliedAt: new Date() }));
    const ledger = mockLedger();
    const prisma = mockPrisma();
    const svc = new InventoryService(repo, ledger, prisma);

    await expect(svc.apply(COUNT_ID, applyInput(9), actor)).rejects.toBeInstanceOf(ConflictError);

    expect(ledger.post).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when the count does not exist', async () => {
    const repo = mockRepo();
    repo.findWithLines.mockResolvedValue(null);
    const ledger = mockLedger();
    const prisma = mockPrisma();
    const svc = new InventoryService(repo, ledger, prisma);

    await expect(svc.apply(COUNT_ID, applyInput(9), actor)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('skips the ledger post when delta is zero', async () => {
    const repo = mockRepo();
    repo.findWithLines.mockResolvedValue(baseCount());
    repo.findLiveStockLevels.mockResolvedValue([{ productId: PID, qty: 9 }]);
    const ledger = mockLedger();
    const prisma = mockPrisma();
    const svc = new InventoryService(repo, ledger, prisma);

    await svc.apply(COUNT_ID, applyInput(9), actor);

    expect(ledger.post).not.toHaveBeenCalled();
    expect(repo.markApplied).toHaveBeenCalledWith(COUNT_ID, FAKE_TX);
  });
});
