import { DomainError, NotFoundError, ValidationError } from '../../../common/errors';
import type { StockLedgerService } from '../../stock-ledger/application/stock-ledger.service';
import type { MovementsRepository } from '../domain/movements.repository';
import type { CreateMovementInput } from '../dto/movement.dto';

import { MovementsService } from './movements.service';

const cuid = (i: number) => `c${'l'.repeat(23)}${i}`;
const PID = cuid(1);
const WH = cuid(2);
const WH2 = cuid(3);

const actor = {
  id: 'user1',
  businessId: 'biz1',
  role: 'owner' as const,
  tokenVersion: 1,
  roleCaps: ['stock.in', 'stock.out', 'stock.transfer'] as never[],
  overrides: {},
};

const mockRepo = (): jest.Mocked<MovementsRepository> =>
  ({
    findPage: jest.fn(),
    findProductRef: jest.fn().mockResolvedValue({ id: PID, name: 'Product 1' }),
    warehouseExists: jest.fn().mockResolvedValue(true),
    logActivity: jest.fn().mockResolvedValue(undefined),
  }) as unknown as jest.Mocked<MovementsRepository>;

const mockLedger = (): jest.Mocked<StockLedgerService> =>
  ({
    post: jest.fn().mockResolvedValue([{ id: 'm1' }]),
  }) as unknown as jest.Mocked<StockLedgerService>;

const baseInput = (over: Partial<CreateMovementInput> = {}): CreateMovementInput => ({
  type: 'in',
  productId: PID,
  qty: 5,
  warehouseId: WH,
  reason: 'achat',
  ...over,
});

describe('MovementsService.record', () => {
  it('type=in calls ledger with positive delta', async () => {
    const repo = mockRepo();
    const ledger = mockLedger();
    const svc = new MovementsService(repo, ledger);

    await svc.record(baseInput({ type: 'in', qty: 5 }), actor);

    expect(ledger.post).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: actor.businessId,
        userId: actor.id,
        type: 'in',
        reason: 'achat',
        lines: [expect.objectContaining({ productId: PID, warehouseId: WH, delta: 5 })],
      }),
    );
  });

  it('type=out calls ledger with negative delta and propagates insufficient_stock', async () => {
    const repo = mockRepo();
    const ledger = mockLedger();
    ledger.post.mockRejectedValue(new DomainError('insufficient_stock', 'nope', 409));
    const svc = new MovementsService(repo, ledger);

    await expect(svc.record(baseInput({ type: 'out', qty: 3, reason: 'vente' }), actor)).rejects.toThrow(
      DomainError,
    );

    expect(ledger.post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'out',
        lines: [expect.objectContaining({ productId: PID, warehouseId: WH, delta: -3 })],
      }),
    );
  });

  it('type=transfer requires toWarehouseId and passes it through', async () => {
    const repo = mockRepo();
    const ledger = mockLedger();
    const svc = new MovementsService(repo, ledger);

    await svc.record(
      baseInput({ type: 'transfer', qty: 2, reason: 'transfert', toWarehouseId: WH2 }),
      actor,
    );

    expect(ledger.post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'transfer',
        toWarehouseId: WH2,
        lines: [expect.objectContaining({ productId: PID, warehouseId: WH, delta: -2 })],
      }),
    );
  });

  it('type=transfer without toWarehouseId → ValidationError', async () => {
    const repo = mockRepo();
    const ledger = mockLedger();
    const svc = new MovementsService(repo, ledger);

    await expect(
      svc.record(baseInput({ type: 'transfer', qty: 2, reason: 'transfert' }), actor),
    ).rejects.toThrow(ValidationError);

    expect(ledger.post).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when product does not exist', async () => {
    const repo = mockRepo();
    repo.findProductRef.mockResolvedValue(null);
    const ledger = mockLedger();
    const svc = new MovementsService(repo, ledger);

    await expect(svc.record(baseInput(), actor)).rejects.toThrow(NotFoundError);
  });
});
