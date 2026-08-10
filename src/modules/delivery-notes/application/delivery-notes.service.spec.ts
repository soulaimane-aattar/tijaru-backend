import type { AuthUser } from '../../../common/auth/auth-user.type';
import { DomainError, NotFoundError } from '../../../common/errors';
import type { DeliveryDetail, DeliveryNotesRepository } from '../domain/delivery-notes.repository';
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
  lines: [{ id: 'l1', productId: PROD, label: 'Coca 33cl', ordered: 10, sent: 0 }],
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
  }) as unknown as jest.Mocked<DeliveryNotesRepository>;

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
    await new DeliveryNotesService(r).create(baseInput(), actor);
    expect(r.create.mock.calls[0]![0].number).toMatch(/^BL-\d{4}-0001$/);
  });

  it('assigns BC prefix for type=order', async () => {
    const r = repo();
    await new DeliveryNotesService(r).create(
      baseInput({ type: 'order', supplierId: SUPPLIER, customerId: undefined }),
      actor,
    );
    expect(r.create.mock.calls[0]![0].number).toMatch(/^BC-\d{4}-/);
  });

  it('assigns BR prefix for type=in_', async () => {
    const r = repo();
    await new DeliveryNotesService(r).create(
      baseInput({ type: 'in_', supplierId: SUPPLIER, customerId: undefined }),
      actor,
    );
    expect(r.create.mock.calls[0]![0].number).toMatch(/^BR-\d{4}-/);
  });

  it('increments from the highest existing number of the same type/year', async () => {
    const r = repo();
    r.findLastNumber.mockResolvedValue('BL-2026-0041');
    await new DeliveryNotesService(r).create(baseInput(), actor);
    expect(r.create.mock.calls[0]![0].number).toBe('BL-2026-0042');
  });

  it('rejects when a line has sent > ordered', async () => {
    const r = repo();
    await expect(
      new DeliveryNotesService(r).create(
        baseInput({ lines: [{ productId: PROD, label: 'x', ordered: 5, sent: 999 }] }),
        actor,
      ),
    ).rejects.toMatchObject({ response: { code: 'invalid_line_sent' } });
  });

  it('starts with derived status = fallback when nothing sent', async () => {
    const r = repo();
    await new DeliveryNotesService(r).create(baseInput({ status: 'shipped' }), actor);
    expect(r.create.mock.calls[0]![0].status).toBe('shipped');
  });

  it('derives status=partial when some sent > 0 but < ordered', async () => {
    const r = repo();
    await new DeliveryNotesService(r).create(
      baseInput({ lines: [{ productId: PROD, label: 'x', ordered: 10, sent: 4 }] }),
      actor,
    );
    expect(r.create.mock.calls[0]![0].status).toBe('partial');
  });

  it('derives status=delivered when every line fully filled', async () => {
    const r = repo();
    await new DeliveryNotesService(r).create(
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
    await expect(new DeliveryNotesService(r).get(BID, 'x')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('DeliveryNotesService.updateLineSent', () => {
  it('rejects when sent > ordered', async () => {
    const r = repo();
    r.findDetail.mockResolvedValue(detail());
    await expect(
      new DeliveryNotesService(r).updateLineSent(BID, 'dn1', 'l1', 999),
    ).rejects.toMatchObject({ response: { code: 'invalid_line_sent' } });
  });

  it('rejects on a closed note', async () => {
    const r = repo();
    r.findDetail.mockResolvedValue(detail({ status: 'closed' }));
    await expect(
      new DeliveryNotesService(r).updateLineSent(BID, 'dn1', 'l1', 1),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it('flips status to delivered once every line is filled', async () => {
    const r = repo();
    r.findDetail
      .mockResolvedValueOnce(detail()) // initial check
      .mockResolvedValueOnce(detail({ lines: [{ id: 'l1', productId: PROD, label: 'x', ordered: 10, sent: 10 }] })); // after refresh
    await new DeliveryNotesService(r).updateLineSent(BID, 'dn1', 'l1', 10);
    expect(r.updateLineSent).toHaveBeenCalledWith('l1', 10);
    expect(r.updateStatus).toHaveBeenCalledWith('dn1', 'delivered');
  });

  it('flips status to partial when the update lands mid-way', async () => {
    const r = repo();
    r.findDetail
      .mockResolvedValueOnce(detail())
      .mockResolvedValueOnce(detail({ lines: [{ id: 'l1', productId: PROD, label: 'x', ordered: 10, sent: 3 }] }));
    await new DeliveryNotesService(r).updateLineSent(BID, 'dn1', 'l1', 3);
    expect(r.updateStatus).toHaveBeenCalledWith('dn1', 'partial');
  });

  it('throws NotFoundError for unknown line', async () => {
    const r = repo();
    r.findDetail.mockResolvedValue(detail());
    await expect(
      new DeliveryNotesService(r).updateLineSent(BID, 'dn1', 'nope', 1),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('DeliveryNotesService.sign', () => {
  it('marks the note signed when type=out', async () => {
    const r = repo();
    r.findDetail.mockResolvedValue(detail());
    await new DeliveryNotesService(r).sign(BID, 'dn1');
    expect(r.markSigned).toHaveBeenCalled();
  });

  it('rejects sign() on non-out types', async () => {
    const r = repo();
    r.findDetail.mockResolvedValue(detail({ type: 'in_' }));
    await expect(new DeliveryNotesService(r).sign(BID, 'dn1')).rejects.toMatchObject({
      response: { code: 'only_out_signable' },
    });
  });

  it('is a no-op when already signed', async () => {
    const r = repo();
    r.findDetail.mockResolvedValue(detail({ signed: true }));
    await new DeliveryNotesService(r).sign(BID, 'dn1');
    expect(r.markSigned).not.toHaveBeenCalled();
  });
});
