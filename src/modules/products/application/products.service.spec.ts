import { NotFoundError, ValidationError } from '../../../common/errors';
import type { PrismaService } from '../../../common/prisma.service';
import type { StockLedgerService } from '../../stock-ledger/application/stock-ledger.service';
import type { ProductsRepository } from '../domain/products.repository';
import type { AdjustProductInput } from '../dto/adjust.dto';
import type { UpdateProductInput } from '../dto/product.dto';

import { ProductsService } from './products.service';

const PID = 'prod1';
const WH = 'wh1';

const actor = {
  id: 'user1',
  businessId: 'biz1',
  role: 'owner' as const,
  tokenVersion: 1,
  roleCaps: ['products.edit'] as never[],
  overrides: {},
};

const mockRepo = (): jest.Mocked<ProductsRepository> =>
  ({
    findAllMatching: jest.fn(),
    findDetail: jest.fn(),
    findByBarcode: jest.fn(),
    findIdentity: jest.fn().mockResolvedValue({ id: PID, name: 'Widget', sku: 'SKU1', barcode: '1234567890123' }),
    hasBarcodeOrSkuConflict: jest.fn().mockResolvedValue(false),
    create: jest.fn(),
    update: jest.fn().mockResolvedValue({ id: PID }),
    softDelete: jest.fn(),
    warehouseExists: jest.fn().mockResolvedValue(true),
    logActivity: jest.fn().mockResolvedValue(undefined),
    duplicateFrom: jest.fn(),
  }) as unknown as jest.Mocked<ProductsRepository>;

const mockLedger = (): jest.Mocked<StockLedgerService> =>
  ({
    post: jest.fn().mockResolvedValue([{ id: 'm1' }]),
  }) as unknown as jest.Mocked<StockLedgerService>;

const FAKE_TX = { __tx: true } as never;

const mockPrisma = (): jest.Mocked<PrismaService> =>
  ({
    $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(FAKE_TX)),
  }) as unknown as jest.Mocked<PrismaService>;

describe('ProductsService.update — no longer accepts stock', () => {
  it('passes the input straight through without a stock argument (Zod already stripped it)', async () => {
    const repo = mockRepo();
    const ledger = mockLedger();
    const prisma = mockPrisma();
    const svc = new ProductsService(repo, ledger, prisma, {} as never);

    const input = { name: 'New name' } as UpdateProductInput;
    await svc.update(PID, input);

    expect(repo.update).toHaveBeenCalledWith(PID, input);
    expect(repo.update).toHaveBeenCalledTimes(1);
    // Repo contract no longer takes a third (stock) argument.
    expect(repo.update.mock.calls[0]?.length).toBe(2);
  });
});

describe('ProductsService.findByBarcode', () => {
  it('returns the product when barcode matches (tenant-scoped)', async () => {
    const repo = mockRepo();
    const ledger = mockLedger();
    const prisma = mockPrisma();
    const svc = new ProductsService(repo, ledger, prisma, {} as never);

    repo.findByBarcode.mockResolvedValue({ id: 'p1', barcode: '4006381333931' } as never);
    await expect(svc.findByBarcode(actor, '4006381333931')).resolves.toMatchObject({ id: 'p1' });
    expect(repo.findByBarcode).toHaveBeenCalledWith('4006381333931');
  });

  it('throws NotFoundError when barcode not found', async () => {
    const repo = mockRepo();
    const ledger = mockLedger();
    const prisma = mockPrisma();
    const svc = new ProductsService(repo, ledger, prisma, {} as never);

    repo.findByBarcode.mockResolvedValue(null);
    await expect(svc.findByBarcode(actor, '0000000000000')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('ProductsService.adjust', () => {
  const baseInput = (over: Partial<AdjustProductInput> = {}): AdjustProductInput => ({
    warehouseId: WH,
    delta: 5,
    reason: 'ecart',
    ...over,
  });

  it('posts a single ledger line with type=in for a positive delta, mapped reason=ajustement', async () => {
    const repo = mockRepo();
    const ledger = mockLedger();
    const prisma = mockPrisma();
    const svc = new ProductsService(repo, ledger, prisma, {} as never);

    await svc.adjust(actor, PID, baseInput({ delta: 5, reason: 'ecart' }));

    expect(ledger.post).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: actor.businessId,
        userId: actor.id,
        type: 'in',
        reason: 'ajustement',
        lines: [expect.objectContaining({ productId: PID, warehouseId: WH, delta: 5 })],
      }),
      FAKE_TX,
    );
  });

  it('posts type=out for a negative delta, mapped reason=casse', async () => {
    const repo = mockRepo();
    const ledger = mockLedger();
    const prisma = mockPrisma();
    const svc = new ProductsService(repo, ledger, prisma, {} as never);

    await svc.adjust(actor, PID, baseInput({ delta: -3, reason: 'casse' }));

    expect(ledger.post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'out',
        reason: 'casse',
        lines: [expect.objectContaining({ productId: PID, warehouseId: WH, delta: -3 })],
      }),
      FAKE_TX,
    );
  });

  it('writes the ledger post and the activity log in the same transaction', async () => {
    const repo = mockRepo();
    const ledger = mockLedger();
    const prisma = mockPrisma();
    const svc = new ProductsService(repo, ledger, prisma, {} as never);

    await svc.adjust(actor, PID, baseInput());

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(ledger.post.mock.calls[0]?.[1]).toBe(FAKE_TX);
    expect(repo.logActivity.mock.calls[0]?.[1]).toBe(FAKE_TX);
  });

  it('rejects a zero delta with ValidationError, without touching the ledger', async () => {
    const repo = mockRepo();
    const ledger = mockLedger();
    const prisma = mockPrisma();
    const svc = new ProductsService(repo, ledger, prisma, {} as never);

    await expect(svc.adjust(actor, PID, baseInput({ delta: 0 }))).rejects.toThrow(ValidationError);
    expect(ledger.post).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when the product does not belong to the tenant', async () => {
    const repo = mockRepo();
    repo.findIdentity.mockResolvedValue(null);
    const ledger = mockLedger();
    const prisma = mockPrisma();
    const svc = new ProductsService(repo, ledger, prisma, {} as never);

    await expect(svc.adjust(actor, PID, baseInput())).rejects.toThrow(NotFoundError);
    expect(ledger.post).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when the warehouse does not exist', async () => {
    const repo = mockRepo();
    repo.warehouseExists.mockResolvedValue(false);
    const ledger = mockLedger();
    const prisma = mockPrisma();
    const svc = new ProductsService(repo, ledger, prisma, {} as never);

    await expect(svc.adjust(actor, PID, baseInput())).rejects.toThrow(NotFoundError);
    expect(ledger.post).not.toHaveBeenCalled();
  });
});
