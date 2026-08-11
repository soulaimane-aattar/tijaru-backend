import type { AuthUser } from '../../../common/auth/auth-user.type';
import { ConflictError, DomainError, NotFoundError } from '../../../common/errors';
import type { PosRepository, SaleProduct } from '../domain/pos.repository';
import type { CreateTicketInput, PaymentInput } from '../dto/pos.dto';

import { PosService } from './pos.service';

const actor: AuthUser = {
  id: 'u1',
  businessId: 'b1',
  roleId: 'r1',
  roleCaps: ['stock.out'],
  device: 'test',
} as unknown as AuthUser;

const cuid = (i: number) => `c${'l'.repeat(23)}${i}`;
const PID_A = cuid(1);
const PID_B = cuid(2);
const WH = cuid(3);
const CUSTOMER = cuid(4);

const PROD_A: SaleProduct = { id: PID_A, name: 'Coca 33cl', sale: 5, vat: 20 };
const PROD_B: SaleProduct = { id: PID_B, name: 'Sidi Ali', sale: 6.5, vat: 20 };

const repo = (): jest.Mocked<PosRepository> =>
  ({
    ensureSession: jest.fn(),
    findSaleProducts: jest.fn(),
    findLastTicketRefs: jest.fn().mockResolvedValue({ ticketNumber: null, movementRef: null }),
    getStockQty: jest.fn(),
    executeCheckout: jest.fn().mockImplementation((d) => Promise.resolve({ id: 't1', ...d })),
    findTicketForResume: jest.fn(),
    markParked: jest.fn(),
    findReceiptData: jest.fn(),
  }) as unknown as jest.Mocked<PosRepository>;

const cashPayment = (tendered: number): PaymentInput => ({ method: 'cash', tendered });

const baseTicket = (over: Partial<CreateTicketInput> = {}): CreateTicketInput =>
  ({
    warehouseId: WH,
    lines: [{ productId: PID_A, qty: 2 }],
    discount: 0,
    payment: cashPayment(50),
    parked: false,
    ...over,
  }) as CreateTicketInput;

describe('PosService — sessions', () => {
  it('ensures a session with the opening float on open()', async () => {
    const r = repo();
    await new PosService(r).openSession({ openingFloat: 200 });
    expect(r.ensureSession).toHaveBeenCalledWith(expect.stringMatching(/^S-\d{8}$/), 200);
  });

  it('reuses the current session with a 0 opening float', async () => {
    const r = repo();
    await new PosService(r).currentSession();
    expect(r.ensureSession).toHaveBeenCalledWith(expect.stringMatching(/^S-\d{8}$/), 0);
  });
});

describe('PosService — checkout math', () => {
  it('computes HT/TVA/total from product price × qty + VAT', async () => {
    const r = repo();
    r.findSaleProducts.mockResolvedValue([PROD_A]);
    r.getStockQty.mockResolvedValue(10);

    await new PosService(r).checkout(baseTicket(), actor);

    expect(r.executeCheckout).toHaveBeenCalledTimes(1);
    const [data] = r.executeCheckout.mock.calls[0]!;
    // 2 × 5 = 10 HT; 20% VAT = 2 TVA; 12 TTC; discount 0.
    expect(data.ht).toBe(10);
    expect(data.tva).toBe(2);
    expect(data.total).toBe(12);
    expect(data.number).toMatch(/^TKT-\d{4}$/);
  });

  it('subtracts the discount from the total', async () => {
    const r = repo();
    r.findSaleProducts.mockResolvedValue([PROD_A]);
    r.getStockQty.mockResolvedValue(10);

    await new PosService(r).checkout(
      baseTicket({ discount: 2, payment: cashPayment(50) }),
      actor,
    );
    expect(r.executeCheckout.mock.calls[0]![0].total).toBe(10);
  });

  it('rejects when the discount exceeds TTC', async () => {
    const r = repo();
    r.findSaleProducts.mockResolvedValue([PROD_A]);
    r.getStockQty.mockResolvedValue(10);
    await expect(
      new PosService(r).checkout(baseTicket({ discount: 999 }), actor),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it('increments the ticket number from the highest existing ref', async () => {
    const r = repo();
    r.findLastTicketRefs.mockResolvedValue({ ticketNumber: 'TKT-0042', movementRef: null });
    r.findSaleProducts.mockResolvedValue([PROD_A]);
    r.getStockQty.mockResolvedValue(10);
    await new PosService(r).checkout(baseTicket(), actor);
    expect(r.executeCheckout.mock.calls[0]![0].number).toBe('TKT-0043');
  });
});

describe('PosService — validations', () => {
  it('throws NotFoundError when a line references an unknown product', async () => {
    const r = repo();
    r.findSaleProducts.mockResolvedValue([]); // none found
    await expect(
      new PosService(r).checkout(baseTicket(), actor),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects insufficient stock at the warehouse', async () => {
    const r = repo();
    r.findSaleProducts.mockResolvedValue([PROD_A]);
    r.getStockQty.mockResolvedValue(1); // asked for 2
    await expect(new PosService(r).checkout(baseTicket(), actor)).rejects.toMatchObject({
      response: { code: 'insufficient_stock' },
    });
  });

  it('rejects checkout when stock insufficient (StockLedger conditional decrement fires)', async () => {
    const r = repo();
    r.findSaleProducts.mockResolvedValue([PROD_A]);
    // Pre-check passes (stock looked sufficient)...
    r.getStockQty.mockResolvedValue(10);
    // ...but the transactional ledger write races another sale and its
    // conditional decrement (qty >= needed) finds none, so the repo/ledger
    // rejects the whole transaction with ConflictError('insufficient_stock').
    r.executeCheckout.mockRejectedValueOnce(new ConflictError('insufficient_stock'));
    await expect(new PosService(r).checkout(baseTicket(), actor)).rejects.toMatchObject({
      response: { title: 'insufficient_stock' },
    });
  });

  it('rejects cash payment below total', async () => {
    const r = repo();
    r.findSaleProducts.mockResolvedValue([PROD_A]);
    r.getStockQty.mockResolvedValue(10);
    await expect(
      new PosService(r).checkout(baseTicket({ payment: cashPayment(1) }), actor),
    ).rejects.toMatchObject({ response: { code: 'insufficient_payment' } });
  });

  it('rejects a split payment whose parts do not add up to the total', async () => {
    const r = repo();
    r.findSaleProducts.mockResolvedValue([PROD_A]);
    r.getStockQty.mockResolvedValue(10);
    await expect(
      new PosService(r).checkout(
        baseTicket({ payment: { method: 'split', cash: 5, card: 5 } as PaymentInput }),
        actor,
      ),
    ).rejects.toMatchObject({ response: { code: 'invalid_split' } });
  });

  it('skips payment + stock checks when parked=true', async () => {
    const r = repo();
    r.findSaleProducts.mockResolvedValue([PROD_A]);
    // No stock at warehouse — but the ticket is parked, so it should still succeed.
    r.getStockQty.mockResolvedValue(0);
    await new PosService(r).checkout(
      baseTicket({ parked: true, payment: cashPayment(0) }),
      actor,
    );
    expect(r.executeCheckout).toHaveBeenCalledTimes(1);
    expect(r.executeCheckout.mock.calls[0]![0].parked).toBe(true);
  });
});

describe('PosService — credit payment', () => {
  it('sets due=total for a credit sale and skips activity logging is not the concern', async () => {
    const r = repo();
    r.findSaleProducts.mockResolvedValue([PROD_A]);
    r.getStockQty.mockResolvedValue(10);
    await new PosService(r).checkout(
      baseTicket({
        customerId: CUSTOMER,
        payment: { method: 'credit', customerId: CUSTOMER } as PaymentInput,
      }),
      actor,
    );
    const [data] = r.executeCheckout.mock.calls[0]!;
    expect(data.due).toBe(data.total);
  });
});

describe('PosService — park / resume', () => {
  it('marks a ticket as parked', async () => {
    const r = repo();
    r.findTicketForResume.mockResolvedValue({
      id: 't1',
      warehouseId: WH,
      customerId: null,
      discount: 0,
      parked: false,
      lines: [{ productId: PID_A, qty: 1 }],
    });
    r.markParked.mockResolvedValue({ id: 't1' });
    await new PosService(r).park('t1');
    expect(r.markParked).toHaveBeenCalledWith('t1');
  });

  it('throws NotFoundError when parking a ticket that does not exist', async () => {
    const r = repo();
    r.findTicketForResume.mockResolvedValue(null);
    await expect(new PosService(r).park('nope')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects resume on a ticket that is not parked', async () => {
    const r = repo();
    r.findTicketForResume.mockResolvedValue({
      id: 't1',
      warehouseId: WH,
      customerId: null,
      discount: 0,
      parked: false,
      lines: [{ productId: PID_A, qty: 1 }],
    });
    await expect(
      new PosService(r).resume('t1', cashPayment(100), actor),
    ).rejects.toMatchObject({ response: { code: 'not_parked' } });
  });

  it('re-checkouts a parked ticket with a fresh payment and replaces the previous row', async () => {
    const r = repo();
    r.findTicketForResume.mockResolvedValue({
      id: 'parked-1',
      warehouseId: WH,
      customerId: null,
      discount: 0,
      parked: true,
      lines: [{ productId: PID_B, qty: 1 }],
    });
    r.findSaleProducts.mockResolvedValue([PROD_B]);
    r.getStockQty.mockResolvedValue(5);

    await new PosService(r).resume('parked-1', cashPayment(50), actor);

    const [, , replaceId] = r.executeCheckout.mock.calls[0]!;
    expect(replaceId).toBe('parked-1');
  });
});

describe('PosService — receipt', () => {
  it('returns a base64 QR payload including number/ice/total/date', async () => {
    const r = repo();
    r.findReceiptData.mockResolvedValue({
      ticket: {
        id: 't1',
        number: 'TKT-0001',
        date: new Date('2026-08-10T09:00:00Z'),
        ht: 10,
        tva: 2,
        total: 12,
        discount: 0,
        due: 0,
        payment: { method: 'cash', tendered: 20 },
        parked: false,
        lines: [],
      },
      cashier: null,
      customer: null,
      warehouse: null,
      business: { name: 'Biz', ice: 'ICE-123', address: null, city: null, phone: null },
    });
    const out = (await new PosService(r).receipt('t1')) as {
      qr: { base64: string; payload: { n: string; ice: string; total: number } };
    };
    expect(out.qr.payload).toMatchObject({ n: 'TKT-0001', ice: 'ICE-123', total: 12 });
    expect(Buffer.from(out.qr.base64, 'base64').toString('utf-8')).toContain('"TKT-0001"');
  });

  it('throws NotFoundError when the ticket does not exist', async () => {
    const r = repo();
    r.findReceiptData.mockResolvedValue(null);
    await expect(new PosService(r).receipt('nope')).rejects.toBeInstanceOf(NotFoundError);
  });
});
