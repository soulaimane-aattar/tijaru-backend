import type { AuthUser } from '../../../common/auth/auth-user.type';
import { DomainError, NotFoundError } from '../../../common/errors';
import type {
  EstimateDetail,
  EstimatesRepository,
} from '../domain/estimates.repository';
import type { CreateEstimateInput } from '../dto/estimates.dto';

import { EstimatesService, computeLineTotals } from './estimates.service';

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

const detail = (over: Partial<EstimateDetail> = {}): EstimateDetail => ({
  id: 'est1',
  number: 'DV-2026-0001',
  date: new Date('2026-08-10'),
  validUntil: new Date('2026-09-10'),
  customerId: CUSTOMER,
  customerName: 'Client',
  issuedById: 'user1',
  issuedByName: 'Youssef',
  status: 'draft',
  ht: 100,
  tva: 20,
  discount: 0,
  total: 120,
  notes: null,
  terms: null,
  lines: [],
  ...over,
});

const repo = (): jest.Mocked<EstimatesRepository> =>
  ({
    findLastNumber: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation((d) => Promise.resolve(detail({ ...d, id: 'est1' }))),
    findDetail: jest.fn(),
    list: jest.fn(),
    update: jest.fn().mockImplementation((_id, d) => Promise.resolve(detail(d))),
    remove: jest.fn().mockResolvedValue(undefined),
  }) as any;

const baseInput = (): CreateEstimateInput => ({
  customerId: CUSTOMER,
  date: new Date('2026-01-15'),
  validUntil: new Date('2026-02-15'),
  lines: [{ productId: PROD_A, label: 'Produit A', qty: 2, priceHt: 50, vat: 20, discount: 0 }],
  discount: 0,
});

describe('computeLineTotals', () => {
  it('computes HT and TVA for a line', () => {
    const t = computeLineTotals({ productId: '', label: '', qty: 3, priceHt: 100, vat: 20, discount: 10 });
    expect(t.lineHt).toBe(290);
    expect(t.lineTva).toBe(58);
  });

  it('clamps negative HT to zero', () => {
    const t = computeLineTotals({ productId: '', label: '', qty: 1, priceHt: 10, vat: 20, discount: 50 });
    expect(t.lineHt).toBe(0);
    expect(t.lineTva).toBe(0);
  });
});

describe('EstimatesService', () => {
  describe('create', () => {
    it('creates an estimate with computed totals', async () => {
      const r = repo();
      const svc = new EstimatesService(r);
      await svc.create(baseInput(), actor);
      expect(r.create).toHaveBeenCalledWith(
        expect.objectContaining({ ht: 100, tva: 20, total: 120, number: 'DV-2026-0001' }),
      );
    });

    it('generates sequential numbers', async () => {
      const r = repo();
      r.findLastNumber.mockResolvedValue('DV-2026-0003');
      const svc = new EstimatesService(r);
      await svc.create(baseInput(), actor);
      expect(r.create).toHaveBeenCalledWith(expect.objectContaining({ number: 'DV-2026-0004' }));
    });

    it('rejects discount exceeding total', async () => {
      const r = repo();
      const svc = new EstimatesService(r);
      await expect(svc.create({ ...baseInput(), discount: 9999 }, actor)).rejects.toThrow(DomainError);
    });
  });

  describe('get', () => {
    it('returns detail when found', async () => {
      const r = repo();
      r.findDetail.mockResolvedValue(detail());
      const svc = new EstimatesService(r);
      const result = await svc.get(BID, 'est1');
      expect(result.id).toBe('est1');
    });

    it('throws NotFoundError when missing', async () => {
      const r = repo();
      r.findDetail.mockResolvedValue(null);
      const svc = new EstimatesService(r);
      await expect(svc.get(BID, 'nope')).rejects.toThrow(NotFoundError);
    });
  });

  describe('list', () => {
    it('delegates to repo with params', async () => {
      const r = repo();
      r.list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 });
      const svc = new EstimatesService(r);
      await svc.list(BID, { page: 1, pageSize: 25 });
      expect(r.list).toHaveBeenCalledWith(expect.objectContaining({ businessId: BID, page: 1 }));
    });
  });

  describe('remove', () => {
    it('deletes a draft estimate', async () => {
      const r = repo();
      r.findDetail.mockResolvedValue(detail({ status: 'draft' }));
      const svc = new EstimatesService(r);
      await svc.remove(BID, 'est1');
      expect(r.remove).toHaveBeenCalledWith('est1');
    });

    it('rejects deletion of non-draft estimate', async () => {
      const r = repo();
      r.findDetail.mockResolvedValue(detail({ status: 'sent' }));
      const svc = new EstimatesService(r);
      await expect(svc.remove(BID, 'est1')).rejects.toThrow(DomainError);
    });

    it('throws NotFoundError for missing estimate', async () => {
      const r = repo();
      r.findDetail.mockResolvedValue(null);
      const svc = new EstimatesService(r);
      await expect(svc.remove(BID, 'nope')).rejects.toThrow(NotFoundError);
    });
  });

  describe('update', () => {
    it('updates status without recomputing totals', async () => {
      const r = repo();
      r.findDetail.mockResolvedValue(detail());
      const svc = new EstimatesService(r);
      await svc.update(BID, 'est1', { status: 'sent' }, actor);
      expect(r.update).toHaveBeenCalledWith('est1', expect.objectContaining({ status: 'sent' }));
    });

    it('recomputes totals when lines are provided', async () => {
      const r = repo();
      r.findDetail.mockResolvedValue(detail());
      const svc = new EstimatesService(r);
      await svc.update(
        BID,
        'est1',
        { lines: [{ productId: PROD_A, label: 'X', qty: 1, priceHt: 200, vat: 10, discount: 0 }] },
        actor,
      );
      expect(r.update).toHaveBeenCalledWith('est1', expect.objectContaining({ ht: 200, tva: 20, total: 220 }));
    });
  });
});
