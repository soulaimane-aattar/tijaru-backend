import { NotFoundError } from '../../../common/errors';
import type { CustomerCategoriesRepository, CustomersRepository } from '../domain/customers.repository';

import { CustomersService } from './customers.service';

const mk = () => {
  const customers = {
    findAll: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  } as jest.Mocked<CustomersRepository>;
  const cats = {
    findAll: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  } as jest.Mocked<CustomerCategoriesRepository>;
  return { customers, cats, svc: new CustomersService(customers, cats) };
};

describe('CustomersService', () => {
  let m: ReturnType<typeof mk>;
  beforeEach(() => {
    jest.clearAllMocks();
    m = mk();
  });

  describe('categories', () => {
    it('listCategories delegates (empty list ok)', async () => {
      m.cats.findAll.mockResolvedValue([]);
      await expect(m.svc.listCategories()).resolves.toEqual([]);
    });

    it('createCategory delegates input', async () => {
      const input = { label: 'VIP', color: '#aabbcc', creditLimit: null };
      m.cats.create.mockResolvedValue({ id: 'k1', ...input });
      await expect(m.svc.createCategory(input)).resolves.toEqual({ id: 'k1', ...input });
      expect(m.cats.create).toHaveBeenCalledWith(input);
    });

    it('updateCategory returns the updated row (single round-trip)', async () => {
      m.cats.update.mockResolvedValue({ id: 'k1', label: 'New' });
      await expect(m.svc.updateCategory('k1', { label: 'New' })).resolves.toEqual({ id: 'k1', label: 'New' });
      expect(m.cats.update).toHaveBeenCalledWith('k1', { label: 'New' });
      expect(m.cats.findById).not.toHaveBeenCalled();
    });

    it('updateCategory throws NotFoundError when no row, without re-reading', async () => {
      m.cats.update.mockResolvedValue(null);
      await expect(m.svc.updateCategory('nope', {})).rejects.toBeInstanceOf(NotFoundError);
      expect(m.cats.findById).not.toHaveBeenCalled();
    });

    it('removeCategory resolves when a row is deleted', async () => {
      m.cats.delete.mockResolvedValue(1);
      await expect(m.svc.removeCategory('k1')).resolves.toBeUndefined();
    });

    it('removeCategory throws NotFoundError on 0 rows', async () => {
      m.cats.delete.mockResolvedValue(0);
      await expect(m.svc.removeCategory('nope')).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('customers', () => {
    it('list passes search through', async () => {
      m.customers.findAll.mockResolvedValue([]);
      await m.svc.list({ search: 'ali' });
      expect(m.customers.findAll).toHaveBeenCalledWith('ali');
    });

    it('get returns row / throws NotFoundError when null', async () => {
      m.customers.findById.mockResolvedValueOnce({ id: 'c1' });
      await expect(m.svc.get('c1')).resolves.toEqual({ id: 'c1' });
      m.customers.findById.mockResolvedValueOnce(null);
      await expect(m.svc.get('x')).rejects.toBeInstanceOf(NotFoundError);
    });

    it.each([['cat1'], [null]])('create forwards categoryId=%s', async (categoryId) => {
      m.cats.findById.mockResolvedValue({ id: 'cat1' });
      m.customers.create.mockResolvedValue({ id: 'c1' });
      await m.svc.create({ name: 'A', categoryId });
      expect(m.customers.create).toHaveBeenCalledWith({ name: 'A', categoryId });
    });

    it.each([['cat1'], [null]])('update forwards categoryId=%s and returns the updated row', async (categoryId) => {
      m.cats.findById.mockResolvedValue({ id: 'cat1' });
      m.customers.update.mockResolvedValue({ id: 'c1', categoryId });
      await expect(m.svc.update('c1', { categoryId })).resolves.toEqual({ id: 'c1', categoryId });
      expect(m.customers.update).toHaveBeenCalledWith('c1', { categoryId });
      expect(m.customers.findById).not.toHaveBeenCalled();
    });

    it('rejects a categoryId not visible to this tenant, without writing', async () => {
      m.cats.findById.mockResolvedValue(null);
      await expect(m.svc.create({ name: 'A', categoryId: 'foreign' })).rejects.toBeInstanceOf(NotFoundError);
      await expect(m.svc.update('c1', { categoryId: 'foreign' })).rejects.toBeInstanceOf(NotFoundError);
      expect(m.customers.create).not.toHaveBeenCalled();
      expect(m.customers.update).not.toHaveBeenCalled();
    });

    it('does not look up a category when categoryId is null/omitted', async () => {
      m.customers.update.mockResolvedValue({ id: 'c1' });
      await m.svc.update('c1', { categoryId: null });
      await m.svc.update('c1', { name: 'B' });
      expect(m.cats.findById).not.toHaveBeenCalled();
    });

    it('update throws NotFoundError when no row', async () => {
      m.customers.update.mockResolvedValue(null);
      await expect(m.svc.update('x', { name: 'B' })).rejects.toBeInstanceOf(NotFoundError);
    });

    it('remove resolves / throws NotFoundError on 0 rows', async () => {
      m.customers.delete.mockResolvedValueOnce(1);
      await expect(m.svc.remove('c1')).resolves.toBeUndefined();
      m.customers.delete.mockResolvedValueOnce(0);
      await expect(m.svc.remove('x')).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
