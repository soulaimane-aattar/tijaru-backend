import type { AuthUser } from '../../../common/auth/auth-user.type';
import { DomainError, NotFoundError } from '../../../common/errors';
import type {
  InvoiceDetail,
  InvoicesRepository,
} from '../domain/invoices.repository';
import type { CreateInvoiceInput } from '../dto/invoices.dto';

import { InvoicesService, computeLineTotals } from './invoices.service';

const cuid = (i: number) => `c${'l'.repeat(23)}${i}`;
const BID = 'biz1';
const CUSTOMER = cuid(1);
const PROD_A = cuid(2);
const actor: AuthUser = {
  id: 'user1',
  businessId: BID,
  roleId: 'admin',
  roleCaps: ['billing.manage'],
} as unknown as AuthUser;

const detail = (over: Partial<InvoiceDetail> = {}): InvoiceDetail => ({
  id: 'inv1',
  number: 'FA-2026-0001',
  date: new Date('2026-08-10'),
  dueDate: new Date('2026-09-10'),
  customerId: CUSTOMER,
  customerName: 'Client',
  issuedById: 'user1',
  issuedByName: 'Youssef',
  status: 'draft',
  ht: 100,
  tva: 20,
  discount: 0,
  total: 120,
  paid: 0,
  notes: null,
  terms: null,
  lines: [],
  ...over,
});

const repo = (): jest.Mocked<InvoicesRepository> =>
  ({
    findLastNumber: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation((d) => Promise.resolve(detail({ ...d, id: 'inv1' }))),
    findDetail: jest.fn(),
    list: jest.fn(),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    addPayment: jest.fn(),
  }) as unknown as jest.Mocked<InvoicesRepository>;

const baseInput = (over: Partial<CreateInvoiceInput> = {}): CreateInvoiceInput => ({
  customerId: CUSTOMER,
  dueDate: new Date('2026-09-10'),
  lines: [
    { productId: PROD_A, label: 'Huile Lesieur 5L', qty: 2, priceHt: 100, vat: 20, discount: 0 },
  ],
  discount: 0,
  status: 'draft',
  ...over,
});

describe('computeLineTotals', () => {
  it('applies per-line discount then VAT', () => {
    expect(computeLineTotals({ productId: 'p', label: 'x', qty: 4, priceHt: 25, vat: 20, discount: 10 })).toEqual({
      lineHt: 90,
      lineTva: 18,
      lineTtc: 108,
    });
  });

  it('clamps line HT at 0 when discount exceeds gross', () => {
    const t = computeLineTotals({ productId: 'p', label: 'x', qty: 1, priceHt: 10, vat: 20, discount: 999 });
    expect(t.lineHt).toBe(0);
    expect(t.lineTva).toBe(0);
  });
});

describe('InvoicesService.create', () => {
  it('computes HT + TVA + total from lines and assigns sequential number', async () => {
    const r = repo();
    r.findLastNumber.mockResolvedValue('FA-2026-0007');
    await new InvoicesService(r).create(baseInput(), actor);

    const [data] = r.create.mock.calls[0]!;
    // 2 × 100 = 200 HT, 20% VAT = 40 TVA, total 240.
    expect(data.ht).toBe(200);
    expect(data.tva).toBe(40);
    expect(data.total).toBe(240);
    expect(data.number).toBe('FA-2026-0008');
  });

  it('subtracts global discount from total', async () => {
    const r = repo();
    await new InvoicesService(r).create(baseInput({ discount: 40 }), actor);
    expect(r.create.mock.calls[0]![0].total).toBe(200);
  });

  it('rejects when global discount exceeds gross total', async () => {
    const r = repo();
    await expect(
      new InvoicesService(r).create(baseInput({ discount: 9999 }), actor),
    ).rejects.toMatchObject({ response: { code: 'invalid_discount' } });
  });

  it('rejects when dueDate is before invoice date', async () => {
    const r = repo();
    await expect(
      new InvoicesService(r).create(
        baseInput({ date: new Date('2026-09-10'), dueDate: new Date('2026-08-10') }),
        actor,
      ),
    ).rejects.toMatchObject({ response: { code: 'invalid_due_date' } });
  });

  it('formats first-of-year number as FA-YYYY-0001', async () => {
    const r = repo();
    r.findLastNumber.mockResolvedValue(null);
    await new InvoicesService(r).create(baseInput(), actor);
    expect(r.create.mock.calls[0]![0].number).toMatch(/^FA-\d{4}-0001$/);
  });

  it('stamps issuedById from the acting user', async () => {
    const r = repo();
    await new InvoicesService(r).create(baseInput(), actor);
    expect(r.create.mock.calls[0]![0].issuedById).toBe(actor.id);
  });
});

describe('InvoicesService.get', () => {
  it('throws NotFoundError when the invoice does not exist', async () => {
    const r = repo();
    r.findDetail.mockResolvedValue(null);
    await expect(new InvoicesService(r).get(BID, 'nope')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('returns the detail when found', async () => {
    const r = repo();
    r.findDetail.mockResolvedValue(detail());
    await expect(new InvoicesService(r).get(BID, 'inv1')).resolves.toMatchObject({ id: 'inv1' });
  });
});

describe('InvoicesService.recordPayment', () => {
  it('moves status to partial when payment is less than total', async () => {
    const r = repo();
    r.findDetail.mockResolvedValue(detail({ total: 120, paid: 0 }));
    r.addPayment.mockResolvedValue(detail({ total: 120, paid: 50, status: 'draft' }));
    const out = await new InvoicesService(r).recordPayment(BID, 'inv1', { amount: 50 });
    expect(r.updateStatus).toHaveBeenCalledWith('inv1', 'partial');
    expect(out.status).toBe('partial');
  });

  it('moves status to paid when payment matches remaining', async () => {
    const r = repo();
    r.findDetail.mockResolvedValue(detail({ total: 120, paid: 50 }));
    r.addPayment.mockResolvedValue(detail({ total: 120, paid: 120, status: 'partial' }));
    const out = await new InvoicesService(r).recordPayment(BID, 'inv1', { amount: 70 });
    expect(r.updateStatus).toHaveBeenCalledWith('inv1', 'paid');
    expect(out.status).toBe('paid');
  });

  it('rejects overpayment', async () => {
    const r = repo();
    r.findDetail.mockResolvedValue(detail({ total: 120, paid: 100 }));
    await expect(
      new InvoicesService(r).recordPayment(BID, 'inv1', { amount: 999 }),
    ).rejects.toMatchObject({ response: { code: 'overpayment' } });
  });

  it('rejects payment on a cancelled invoice', async () => {
    const r = repo();
    r.findDetail.mockResolvedValue(detail({ status: 'cancelled' }));
    await expect(
      new InvoicesService(r).recordPayment(BID, 'inv1', { amount: 10 }),
    ).rejects.toMatchObject({ response: { code: 'cancelled_invoice' } });
  });

  it('throws NotFoundError when invoice is missing', async () => {
    const r = repo();
    r.findDetail.mockResolvedValue(null);
    await expect(
      new InvoicesService(r).recordPayment(BID, 'x', { amount: 1 }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('InvoicesService.cancel', () => {
  it('cancels a draft invoice', async () => {
    const r = repo();
    r.findDetail.mockResolvedValue(detail({ status: 'draft', paid: 0 }));
    await new InvoicesService(r).cancel(BID, 'inv1');
    expect(r.updateStatus).toHaveBeenCalledWith('inv1', 'cancelled');
  });

  it('refuses to cancel a paid invoice', async () => {
    const r = repo();
    r.findDetail.mockResolvedValue(detail({ status: 'paid' }));
    await expect(new InvoicesService(r).cancel(BID, 'inv1')).rejects.toBeInstanceOf(DomainError);
  });

  it('refuses to cancel when a partial payment exists', async () => {
    const r = repo();
    r.findDetail.mockResolvedValue(detail({ status: 'partial', paid: 10 }));
    await expect(new InvoicesService(r).cancel(BID, 'inv1')).rejects.toMatchObject({
      response: { code: 'cannot_cancel_with_payments' },
    });
  });

  it('throws NotFoundError when invoice is missing', async () => {
    const r = repo();
    r.findDetail.mockResolvedValue(null);
    await expect(new InvoicesService(r).cancel(BID, 'x')).rejects.toBeInstanceOf(NotFoundError);
  });
});
