import type { AuthUser } from '../../../common/auth/auth-user.type';
import { DomainError, NotFoundError } from '../../../common/errors';
import type { PrismaService } from '../../../common/prisma.service';
import type { StockLedgerService } from '../../stock-ledger/application/stock-ledger.service';
import type {
  DeliveryDetail,
  DeliveryNotesRepository,
  ProductPriceLookup,
} from '../domain/delivery-notes.repository';
import type { CreateDeliveryNoteInput } from '../dto/delivery-notes.dto';

import { DeliveryNotesService, statusFromLines } from './delivery-notes.service';

const cuid = (i: number) => `c${'l'.repeat(23)}${i}`;
const BID = 'biz1';
const CUSTOMER = cuid(1);
const SUPPLIER = cuid(2);
const PROD = cuid(3);

const actor: AuthUser = {
  id: 'user1',
  businessId: BID,
  roleId: 'admin',
  roleCaps: ['po.manage'],
} as unknown as AuthUser;

const detail = (over: Partial<DeliveryDetail> = {}): DeliveryDetail => ({
  id: 'dn1',
  number: 'BL-2026-0001',
  type: 'out',
  date: new Date('2026-08-10'),
  status: 'prepared',
  customerId: CUSTOMER,
  customerName: 'Client',
  supplierId: null,
  supplierName: null,
  issuedById: 'user1',
  issuedByName: 'Youssef',
  sourceRef: null,
  carrier: null,
  signed: false,
  notes: null,
  lines: [{ id: 'l1', productId: PROD, label: 'Coca 33cl', ordered: 10, sent: 0, unitPrice: 0 }],
  ...over,
});

const repo = (): jest.Mocked<DeliveryNotesRepository> =>
  ({
    findLastNumber: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation((d) => Promise.resolve(detail({ ...d, id: 'dn1' }))),
    findDetail: jest.fn(),
    list: jest.fn(),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    updateLineSent: jest.fn().mockResolvedValue(undefined),
    markSigned: jest.fn().mockResolvedValue(undefined),
    findDefaultWarehouseId: jest.fn().mockResolvedValue('wh1'),
  }) as unknown as jest.Mocked<DeliveryNotesRepository>;

const products = (): jest.Mocked<ProductPriceLookup> =>
  ({
    findById: jest.fn().mockResolvedValue({ id: PROD, price: 0 }),
  }) as unknown as jest.Mocked<ProductPriceLookup>;

const ledger = (): jest.Mocked<StockLedgerService> =>
  ({
    post: jest.fn().mockResolvedValue([]),
  }) as unknown as jest.Mocked<StockLedgerService>;

/** `$transaction` runs the callback with a stand-in tx client; repo/ledger mocks ignore its identity. */
const prisma = (): jest.Mocked<PrismaService> =>
  ({
    $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn({})),
  }) as unknown as jest.Mocked<PrismaService>;

const makeSvc = (
  r: jest.Mocked<DeliveryNotesRepository>,
  p: jest.Mocked<ProductPriceLookup>,
  l: jest.Mocked<StockLedgerService> = ledger(),
  tx: jest.Mocked<PrismaService> = prisma(),
) => new DeliveryNotesService(r, p, l, tx);

const baseInput = (over: Partial<CreateDeliveryNoteInput> = {}): CreateDeliveryNoteInput =>
  ({
    type: 'out',
    customerId: CUSTOMER,
    status: 'prepared',
    lines: [{ productId: PROD, label: 'Coca 33cl', ordered: 10, sent: 0 }],
    ...over,
  }) as CreateDeliveryNoteInput;

describe('statusFromLines', () => {
  it('returns fallback when nothing sent', () => {
    expect(statusFromLines([{ ordered: 10, sent: 0 }], 'prepared')).toBe('prepared');
    expect(statusFromLines([{ ordered: 10, sent: 0 }], 'shipped')).toBe('shipped');
  });

  it('returns partial when some sent < ordered', () => {
    expect(statusFromLines([{ ordered: 10, sent: 4 }], 'prepared')).toBe('partial');
  });

  it('returns delivered when all sent >= ordered', () => {
    expect(
      statusFromLines(
        [
          { ordered: 10, sent: 10 },
          { ordered: 5, sent: 5 },
        ],
        'prepared',
      ),
    ).toBe('delivered');
  });

  it('caps line sent at ordered when computing done', () => {
    expect(statusFromLines([{ ordered: 5, sent: 999 }], 'prepared')).toBe('delivered');
  });
});

describe('DeliveryNotesService.create', () => {
  it('assigns BL prefix for type=out', async () => {
    const r = repo();
    await makeSvc(r, products()).create(baseInput(), actor);
    expect(r.create.mock.calls[0]![0].number).toMatch(/^BL-\d{4}-0001$/);
  });

  it('assigns BC prefix for type=order', async () => {
    const r = repo();
    await makeSvc(r, products()).create(
      baseInput({ type: 'order', supplierId: SUPPLIER, customerId: undefined }),
      actor,
    );
    expect(r.create.mock.calls[0]![0].number).toMatch(/^BC-\d{4}-/);
  });

  it('assigns BR prefix for type=in_', async () => {
    const r = repo();
    await makeSvc(r, products()).create(
      baseInput({ type: 'in_', supplierId: SUPPLIER, customerId: undefined }),
      actor,
    );
    expect(r.create.mock.calls[0]![0].number).toMatch(/^BR-\d{4}-/);
  });

  it('increments from the highest existing number of the same type/year', async () => {
    const r = repo();
    r.findLastNumber.mockResolvedValue('BL-2026-0041');
    await makeSvc(r, products()).create(baseInput(), actor);
    expect(r.create.mock.calls[0]![0].number).toBe('BL-2026-0042');
  });

  it('rejects when a line has sent > ordered', async () => {
    const r = repo();
    await expect(
      makeSvc(r, products()).create(
        baseInput({ lines: [{ productId: PROD, label: 'x', ordered: 5, sent: 999 }] }),
        actor,
      ),
    ).rejects.toMatchObject({ response: { code: 'invalid_line_sent' } });
  });

  it('starts with derived status = fallback when nothing sent', async () => {
    const r = repo();
    await makeSvc(r, products()).create(baseInput({ status: 'shipped' }), actor);
    expect(r.create.mock.calls[0]![0].status).toBe('shipped');
  });

  it('derives status=partial when some sent > 0 but < ordered', async () => {
    const r = repo();
    await makeSvc(r, products()).create(
      baseInput({ lines: [{ productId: PROD, label: 'x', ordered: 10, sent: 4 }] }),
      actor,
    );
    expect(r.create.mock.calls[0]![0].status).toBe('partial');
  });

  it('derives status=delivered when every line fully filled', async () => {
    const r = repo();
    await makeSvc(r, products()).create(
      baseInput({ lines: [{ productId: PROD, label: 'x', ordered: 10, sent: 10 }] }),
      actor,
    );
    expect(r.create.mock.calls[0]![0].status).toBe('delivered');
  });
});

describe('DeliveryNotesService.get', () => {
  it('throws NotFoundError when the note is missing', async () => {
    const r = repo();
    r.findDetail.mockResolvedValue(null);
    await expect(makeSvc(r, products()).get(BID, 'x')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('DeliveryNotesService.updateLineSent', () => {
  it('rejects when sent > ordered', async () => {
    const r = repo();
    r.findDetail.mockResolvedValue(detail());
    await expect(
      makeSvc(r, products()).updateLineSent(BID, 'dn1', 'l1', 999),
    ).rejects.toMatchObject({ response: { code: 'invalid_line_sent' } });
  });

  it('rejects on a closed note', async () => {
    const r = repo();
    r.findDetail.mockResolvedValue(detail({ status: 'closed' }));
    await expect(
      makeSvc(r, products()).updateLineSent(BID, 'dn1', 'l1', 1),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it('flips status to delivered once every line is filled', async () => {
    const r = repo();
    r.findDetail
      .mockResolvedValueOnce(detail()) // initial check
      .mockResolvedValueOnce(detail({ lines: [{ id: 'l1', productId: PROD, label: 'x', ordered: 10, sent: 10, unitPrice: 0 }] })); // after refresh
    await makeSvc(r, products()).updateLineSent(BID, 'dn1', 'l1', 10);
    expect(r.updateLineSent).toHaveBeenCalledWith('l1', 10);
    expect(r.updateStatus).toHaveBeenCalledWith('dn1', 'delivered');
  });

  it('flips status to partial when the update lands mid-way', async () => {
    const r = repo();
    r.findDetail
      .mockResolvedValueOnce(detail())
      .mockResolvedValueOnce(detail({ lines: [{ id: 'l1', productId: PROD, label: 'x', ordered: 10, sent: 3, unitPrice: 0 }] }));
    await makeSvc(r, products()).updateLineSent(BID, 'dn1', 'l1', 3);
    expect(r.updateStatus).toHaveBeenCalledWith('dn1', 'partial');
  });

  it('throws NotFoundError for unknown line', async () => {
    const r = repo();
    r.findDetail.mockResolvedValue(detail());
    await expect(
      makeSvc(r, products()).updateLineSent(BID, 'dn1', 'nope', 1),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('DeliveryNotesService.sign', () => {
  it('marks the note signed when type=out', async () => {
    const r = repo();
    r.findDetail.mockResolvedValue(detail());
    await makeSvc(r, products()).sign(BID, 'dn1', actor);
    expect(r.markSigned).toHaveBeenCalled();
  });

  it('sign(out) posts negative ledger lines from DN lines (only lines with sent > 0)', async () => {
    const r = repo();
    r.findDetail.mockResolvedValue(
      detail({
        type: 'out',
        lines: [
          { id: 'l1', productId: PROD, label: 'Coca 33cl', ordered: 10, sent: 4, unitPrice: 0 },
          { id: 'l2', productId: 'p2', label: 'Fanta 33cl', ordered: 5, sent: 0, unitPrice: 0 },
        ],
      }),
    );
    const l = ledger();
    await makeSvc(r, products(), l).sign(BID, 'dn1', actor);
    expect(l.post).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: BID,
        userId: actor.id,
        type: 'out',
        reason: 'vente',
        ref: 'BL-2026-0001',
        lines: [{ productId: PROD, warehouseId: 'wh1', delta: -4 }],
      }),
      expect.anything(),
    );
    expect(r.markSigned).toHaveBeenCalled();
  });

  it('sign(in_) posts positive ledger lines', async () => {
    const r = repo();
    r.findDetail.mockResolvedValue(
      detail({
        type: 'in_',
        customerId: null,
        supplierId: SUPPLIER,
        lines: [{ id: 'l1', productId: PROD, label: 'Coca 33cl', ordered: 10, sent: 6, unitPrice: 0 }],
      }),
    );
    const l = ledger();
    await makeSvc(r, products(), l).sign(BID, 'dn1', actor);
    expect(l.post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'in',
        reason: 'achat',
        lines: [{ productId: PROD, warehouseId: 'wh1', delta: 6 }],
      }),
      expect.anything(),
    );
    expect(r.markSigned).toHaveBeenCalled();
  });

  it('sign(order) does not touch stock', async () => {
    const r = repo();
    r.findDetail.mockResolvedValue(
      detail({
        type: 'order',
        customerId: null,
        supplierId: SUPPLIER,
        lines: [{ id: 'l1', productId: PROD, label: 'Coca 33cl', ordered: 10, sent: 6, unitPrice: 0 }],
      }),
    );
    const l = ledger();
    await makeSvc(r, products(), l).sign(BID, 'dn1', actor);
    expect(l.post).not.toHaveBeenCalled();
    expect(r.markSigned).toHaveBeenCalled();
  });

  it('re-signing an already-signed DN is a no-op (idempotent)', async () => {
    const r = repo();
    r.findDetail.mockResolvedValue(detail({ signed: true }));
    const l = ledger();
    await makeSvc(r, products(), l).sign(BID, 'dn1', actor);
    expect(r.markSigned).not.toHaveBeenCalled();
    expect(l.post).not.toHaveBeenCalled();
  });
});

describe('unit price + totals', () => {
  it('prefills unitPrice from product.price when line omits it', async () => {
    const r = repo();
    const p = products();
    p.findById.mockResolvedValue({ id: PROD, price: '12.50' } as any);
    await makeSvc(r, p).create(
      baseInput({ lines: [{ productId: PROD, label: 'X', ordered: 2, sent: 0 }] }),
      actor,
    );
    expect(r.create.mock.calls[0]![0].lines).toEqual([
      expect.objectContaining({ unitPrice: 12.5 }),
    ]);
  });

  it('keeps explicit unitPrice', async () => {
    const r = repo();
    const p = products();
    p.findById.mockResolvedValue({ id: PROD, price: '99' } as any);
    await makeSvc(r, p).create(
      baseInput({ lines: [{ productId: PROD, label: 'X', ordered: 2, sent: 0, unitPrice: 5 } as any] }),
      actor,
    );
    expect(r.create.mock.calls[0]![0].lines).toEqual([
      expect.objectContaining({ unitPrice: 5 }),
    ]);
    expect(p.findById).not.toHaveBeenCalled();
  });

  it('computeTotals: BL uses sent × unitPrice', () => {
    const note = {
      type: 'out' as const,
      lines: [
        { sent: '3', ordered: '5', unitPrice: '10' },
        { sent: '2', ordered: '2', unitPrice: '7.5' },
      ],
    };
    expect(makeSvc(repo(), products()).computeTotals(note as any).subtotal).toBe(45);
  });

  it('computeTotals: BC/BR uses ordered × unitPrice', () => {
    const svc = makeSvc(repo(), products());
    const noteBC = { type: 'order' as const, lines: [{ sent: '0', ordered: '4', unitPrice: '25' }] };
    const noteBR = { type: 'in_' as const, lines: [{ sent: '0', ordered: '3', unitPrice: '10' }] };
    expect(svc.computeTotals(noteBC as any).subtotal).toBe(100);
    expect(svc.computeTotals(noteBR as any).subtotal).toBe(30);
  });

  it('computeTotals: empty lines → 0', () => {
    expect(
      makeSvc(repo(), products()).computeTotals({ type: 'out', lines: [] } as any)
        .subtotal,
    ).toBe(0);
  });

  it('get() attaches per-line subtotal and note totals', async () => {
    const r = repo();
    r.findDetail.mockResolvedValue(
      detail({
        type: 'out',
        lines: [{ id: 'l1', productId: PROD, label: 'X', ordered: 10, sent: 4, unitPrice: 2.5 }],
      }),
    );
    const result = await makeSvc(r, products()).get(BID, 'dn1');
    expect(result.lines[0]).toEqual(expect.objectContaining({ unitPrice: 2.5, subtotal: 10 }));
    expect(result.totals).toEqual({ subtotal: 10 });
  });
});
