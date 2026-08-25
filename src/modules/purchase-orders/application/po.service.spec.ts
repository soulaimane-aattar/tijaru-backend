import { DomainError, NotFoundError } from '../../../common/errors';
import type { PrismaService } from '../../../common/prisma.service';
import type { StockLedgerService } from '../../stock-ledger/application/stock-ledger.service';
import type { POView } from '../domain/po.repository';
import type { PurchaseOrdersRepository } from '../domain/po.repository';
import type { ReceivePOInput } from '../dto/po.dto';

import { POService } from './po.service';

const cuid = (i: number) => `c${'l'.repeat(23)}${i}`;
const PO_ID = cuid(1);
const PID = cuid(2);
const PID2 = cuid(3);
const WH = cuid(4);
const LINE_ID = cuid(5);
const LINE_ID2 = cuid(6);

const actor = {
  id: 'user1',
  businessId: 'biz1',
  role: 'owner' as const,
  tokenVersion: 1,
  roleCaps: [] as never[],
  overrides: {},
};

const basePO = (over: Partial<POView> = {}): POView => ({
  id: PO_ID,
  number: 'BC-2026-0001',
  status: 'sent',
  warehouseId: WH,
  lines: [{ id: LINE_ID, productId: PID, qty: 5, received: 0, price: 12.5 }],
  ...over,
});

const mockRepo = (): jest.Mocked<PurchaseOrdersRepository> =>
  ({
    findAll: jest.fn(),
    findDetail: jest.fn().mockResolvedValue({ id: PO_ID }),
    findLastNumber: jest.fn(),
    create: jest.fn(),
    findStatus: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findWithLines: jest.fn().mockResolvedValue(basePO()),
    incrementLineReceived: jest.fn().mockResolvedValue(undefined),
    findLineTotals: jest.fn().mockResolvedValue([{ qty: 5, received: 5 }]),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    logActivity: jest.fn().mockResolvedValue(undefined),
  }) as unknown as jest.Mocked<PurchaseOrdersRepository>;

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

const receiveInput = (lines: ReceivePOInput['lines']): ReceivePOInput => ({ lines });

describe('POService.patch', () => {
  it('replaces lines on a draft PO', async () => {
    const repo = mockRepo();
    repo.findStatus.mockResolvedValue('draft');
    const svc = new POService(repo, mockLedger(), mockPrisma());
    const lines = [{ productId: PID, qty: 3, price: 10, vat: 20 as const }];
    await svc.patch(PO_ID, { lines });
    expect(repo.update).toHaveBeenCalledWith(PO_ID, { lines });
  });

  it('rejects line edits on a sent PO (not_draft)', async () => {
    const repo = mockRepo();
    repo.findStatus.mockResolvedValue('sent');
    const svc = new POService(repo, mockLedger(), mockPrisma());
    await expect(
      svc.patch(PO_ID, { lines: [{ productId: PID, qty: 1, price: 1, vat: 0 as const }] }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('still allows status/notes on a sent PO', async () => {
    const repo = mockRepo();
    repo.findStatus.mockResolvedValue('sent');
    const svc = new POService(repo, mockLedger(), mockPrisma());
    await svc.patch(PO_ID, { status: 'cancelled', notes: 'n' });
    expect(repo.update).toHaveBeenCalledWith(PO_ID, { status: 'cancelled', notes: 'n' });
  });
});

describe('POService.receive', () => {
  it('receive posts ledger lines with unitCost from PO line', async () => {
    const repo = mockRepo();
    const ledger = mockLedger();
    const prisma = mockPrisma();
    const svc = new POService(repo, ledger, prisma);

    await svc.receive(PO_ID, receiveInput([{ lineId: LINE_ID, qty: 5 }]), actor);

    expect(ledger.post).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: actor.businessId,
        userId: actor.id,
        type: 'in',
        reason: 'achat',
        ref: 'BC-2026-0001',
        lines: expect.arrayContaining([
          expect.objectContaining({ productId: PID, warehouseId: WH, delta: 5, unitCost: 12.5 }),
        ]),
      }),
      FAKE_TX,
    );
  });

  it('increments received per line, recomputes status, and logs the activity inside the transaction', async () => {
    const repo = mockRepo();
    repo.findLineTotals.mockResolvedValue([{ qty: 5, received: 5 }]);
    const ledger = mockLedger();
    const prisma = mockPrisma();
    const svc = new POService(repo, ledger, prisma);

    await svc.receive(PO_ID, receiveInput([{ lineId: LINE_ID, qty: 5 }]), actor);

    expect(repo.incrementLineReceived).toHaveBeenCalledWith(LINE_ID, 5, FAKE_TX);
    expect(repo.updateStatus).toHaveBeenCalledWith(PO_ID, 'received', FAKE_TX);
    expect(repo.logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ userId: actor.id, action: 'po.received' }),
      FAKE_TX,
    );
  });

  it('supports partial receipt: status recomputes to partiallyReceived and posts only the delta received', async () => {
    const repo = mockRepo();
    repo.findWithLines.mockResolvedValue(
      basePO({ lines: [{ id: LINE_ID, productId: PID, qty: 10, received: 0, price: 3 }] }),
    );
    repo.findLineTotals.mockResolvedValue([{ qty: 10, received: 4 }]);
    const ledger = mockLedger();
    const prisma = mockPrisma();
    const svc = new POService(repo, ledger, prisma);

    await svc.receive(PO_ID, receiveInput([{ lineId: LINE_ID, qty: 4 }]), actor);

    expect(ledger.post).toHaveBeenCalledWith(
      expect.objectContaining({
        lines: expect.arrayContaining([expect.objectContaining({ delta: 4, unitCost: 3 })]),
      }),
      FAKE_TX,
    );
    expect(repo.updateStatus).toHaveBeenCalledWith(PO_ID, 'partiallyReceived', FAKE_TX);
  });

  it('rejects over-receiving beyond the remaining qty and posts nothing', async () => {
    const repo = mockRepo();
    repo.findWithLines.mockResolvedValue(
      basePO({ lines: [{ id: LINE_ID, productId: PID, qty: 5, received: 3 }] as never }),
    );
    const ledger = mockLedger();
    const prisma = mockPrisma();
    const svc = new POService(repo, ledger, prisma);

    await expect(
      svc.receive(PO_ID, receiveInput([{ lineId: LINE_ID, qty: 3 }]), actor),
    ).rejects.toBeInstanceOf(DomainError);

    expect(ledger.post).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects receiving a cancelled PO', async () => {
    const repo = mockRepo();
    repo.findWithLines.mockResolvedValue(basePO({ status: 'cancelled' }));
    const ledger = mockLedger();
    const prisma = mockPrisma();
    const svc = new POService(repo, ledger, prisma);

    await expect(
      svc.receive(PO_ID, receiveInput([{ lineId: LINE_ID, qty: 1 }]), actor),
    ).rejects.toBeInstanceOf(DomainError);

    expect(ledger.post).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when the PO does not exist', async () => {
    const repo = mockRepo();
    repo.findWithLines.mockResolvedValue(null);
    const ledger = mockLedger();
    const prisma = mockPrisma();
    const svc = new POService(repo, ledger, prisma);

    await expect(
      svc.receive(PO_ID, receiveInput([{ lineId: LINE_ID, qty: 1 }]), actor),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws NotFoundError when a receipt line id is not part of the PO', async () => {
    const repo = mockRepo();
    const ledger = mockLedger();
    const prisma = mockPrisma();
    const svc = new POService(repo, ledger, prisma);

    await expect(
      svc.receive(PO_ID, receiveInput([{ lineId: LINE_ID2, qty: 1 }]), actor),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('posts one ledger line per PO line when receiving multiple lines at once', async () => {
    const repo = mockRepo();
    repo.findWithLines.mockResolvedValue(
      basePO({
        lines: [
          { id: LINE_ID, productId: PID, qty: 5, received: 0, price: 12.5 },
          { id: LINE_ID2, productId: PID2, qty: 2, received: 0, price: 7 },
        ],
      }),
    );
    const ledger = mockLedger();
    const prisma = mockPrisma();
    const svc = new POService(repo, ledger, prisma);

    await svc.receive(
      PO_ID,
      receiveInput([
        { lineId: LINE_ID, qty: 5 },
        { lineId: LINE_ID2, qty: 2 },
      ]),
      actor,
    );

    expect(ledger.post).toHaveBeenCalledWith(
      expect.objectContaining({
        lines: [
          expect.objectContaining({ productId: PID, delta: 5, unitCost: 12.5 }),
          expect.objectContaining({ productId: PID2, delta: 2, unitCost: 7 }),
        ],
      }),
      FAKE_TX,
    );
  });
});
