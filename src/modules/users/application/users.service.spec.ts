import type { Env } from '../../../config/env';
import type { UsersRepository } from '../domain/users.repository';

import { UsersService } from './users.service';

const repo = () =>
  ({
    emailInUse: jest.fn().mockResolvedValue(false),
    exists: jest.fn().mockResolvedValue(true),
    findRole: jest.fn().mockResolvedValue('cashier'),
    activeModuleIds: jest.fn().mockResolvedValue(['pos', 'expenses', 'stock']),
    create: jest.fn().mockResolvedValue({ id: 'u1' }),
    update: jest.fn().mockResolvedValue({ id: 'u1' }),
  }) as unknown as jest.Mocked<UsersRepository>;

const svc = (r: jest.Mocked<UsersRepository>) =>
  new UsersService(r, { BCRYPT_COST: 4 } as unknown as Env);

const base = { name: 'A', email: 'a@x.ma', password: 'password1', role: 'cashier' as const, warehouseIds: [] };

describe('UsersService module access', () => {
  it('creates an unrestricted user by default', async () => {
    const r = repo();
    await svc(r).create(base);
    expect(r.create).toHaveBeenCalledWith(
      expect.objectContaining({ restrictModules: false, moduleAccess: [] }),
    );
  });

  it('stores an allow-list (deduplicated) when modules are given', async () => {
    const r = repo();
    await svc(r).create({ ...base, modules: ['pos', 'pos'] });
    expect(r.create).toHaveBeenCalledWith(
      expect.objectContaining({ restrictModules: true, moduleAccess: ['pos'] }),
    );
  });

  it('rejects a module the business does not have active', async () => {
    const r = repo();
    await expect(svc(r).create({ ...base, modules: ['pos', 'hr'] })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'module_not_available' }),
    });
    expect(r.create).not.toHaveBeenCalled();
  });

  it('rejects restricting an owner', async () => {
    const r = repo();
    await expect(svc(r).create({ ...base, role: 'owner', modules: ['pos'] })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'owner_unrestricted' }),
    });
  });

  it('update: modules=null lifts the restriction', async () => {
    const r = repo();
    await svc(r).update('u1', { modules: null });
    expect(r.update).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ restrictModules: false, moduleAccess: [] }),
      undefined,
    );
  });

  it('update: omitting modules leaves access untouched', async () => {
    const r = repo();
    await svc(r).update('u1', { name: 'B' });
    const data = r.update.mock.calls[0]![1];
    expect(data).not.toHaveProperty('restrictModules');
    expect(data).not.toHaveProperty('moduleAccess');
  });

  it('update: rejects restricting a user who is an owner', async () => {
    const r = repo();
    r.findRole.mockResolvedValue('owner');
    await expect(svc(r).update('u1', { modules: ['pos'] })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'owner_unrestricted' }),
    });
  });

  it('update: promoting to owner clears any restriction', async () => {
    const r = repo();
    await svc(r).update('u1', { role: 'owner' });
    expect(r.update).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ restrictModules: false, moduleAccess: [] }),
      undefined,
    );
  });
});
