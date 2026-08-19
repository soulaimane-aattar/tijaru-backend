import { NotFoundError, ValidationError } from '../../../common/errors';
import type {
  ExpenseCategoriesRepository,
  ExpenseCategoryView,
} from '../domain/expense-categories.repository';

import { ExpenseCategoriesService } from './expense-categories.service';

const view = (over: Partial<ExpenseCategoryView> = {}): ExpenseCategoryView => ({
  id: 'cat-1',
  key: 'rent',
  label: 'Loyer',
  taxRate: 20,
  sortOrder: 10,
  archived: false,
  ...over,
});

const repo = (): jest.Mocked<ExpenseCategoriesRepository> =>
  ({
    findAll: jest.fn(),
    findById: jest.fn(),
    findByKey: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    countUses: jest.fn(),
    delete: jest.fn(),
  }) as unknown as jest.Mocked<ExpenseCategoriesRepository>;

const service = (r = repo()) => ({ svc: new ExpenseCategoriesService(r), r });

describe('ExpenseCategoriesService', () => {
  it('lists non-archived by default', async () => {
    const { svc, r } = service();
    r.findAll.mockResolvedValue([view()]);
    await svc.list({});
    expect(r.findAll).toHaveBeenCalledWith(false);
  });

  it('rejects a duplicate key on create', async () => {
    const { svc, r } = service();
    r.findByKey.mockResolvedValue(view({ key: 'rent' }));
    await expect(
      svc.create({ key: 'rent', label: 'Loyer', taxRate: 20, sortOrder: 10 }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(r.create).not.toHaveBeenCalled();
  });

  it('creates when the key is unused', async () => {
    const { svc, r } = service();
    r.findByKey.mockResolvedValue(null);
    r.create.mockResolvedValue(view({ key: 'travel' }));
    const out = await svc.create({ key: 'travel', label: 'Voyage', taxRate: 10, sortOrder: 100 });
    expect(out.key).toBe('travel');
    expect(r.create).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'travel', taxRate: 10 }),
    );
  });

  it('throws NotFound when updating a missing category', async () => {
    const { svc, r } = service();
    r.findById.mockResolvedValue(null);
    await expect(svc.update('missing', { label: 'X' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('archives when the category is still referenced', async () => {
    const { svc, r } = service();
    r.findById.mockResolvedValue(view());
    r.countUses.mockResolvedValue(3);
    r.update.mockResolvedValue(1);
    await expect(svc.remove('cat-1')).resolves.toEqual({ archived: true, deleted: false });
    expect(r.update).toHaveBeenCalledWith('cat-1', { archived: true });
    expect(r.delete).not.toHaveBeenCalled();
  });

  it('hard-deletes when unused', async () => {
    const { svc, r } = service();
    r.findById.mockResolvedValue(view());
    r.countUses.mockResolvedValue(0);
    r.delete.mockResolvedValue(1);
    await expect(svc.remove('cat-1')).resolves.toEqual({ archived: false, deleted: true });
    expect(r.delete).toHaveBeenCalledWith('cat-1');
  });
});
