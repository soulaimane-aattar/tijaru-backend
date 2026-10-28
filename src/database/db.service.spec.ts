import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';

import { Db } from './db.service';
import type { DB } from './types';

// DummyDriver: real Kysely transaction semantics (commit / rollback on throw), no database.
const dummy = () =>
  new Kysely<DB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });

describe('Db.afterCommit', () => {
  const db = new Db(dummy(), dummy(), { getBusinessId: () => 'biz' } as never);

  it('runs callbacks after the scope commits', async () => {
    const order: string[] = [];
    await db.scope({ businessId: 'biz' }, async () => {
      await db.afterCommit(() => void order.push('cb'));
      order.push('body');
    });
    expect(order).toEqual(['body', 'cb']);
  });

  it('drops callbacks when the scope rolls back', async () => {
    const cb = jest.fn();
    await expect(
      db.scope({ businessId: 'biz' }, async () => {
        await db.afterCommit(cb);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(cb).not.toHaveBeenCalled();
  });

  it('runs immediately outside a scope', async () => {
    const cb = jest.fn();
    await db.afterCommit(cb);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('swallows callback failures (logged, request still succeeds)', async () => {
    const second = jest.fn();
    const res = await db.scope({ businessId: 'biz' }, async () => {
      await db.afterCommit(() => Promise.reject(new Error('webhook down')));
      await db.afterCommit(second);
      return 'ok';
    });
    expect(res).toBe('ok');
    expect(second).toHaveBeenCalled();
  });

  it('tx() joins the scope: its callbacks wait for the outer commit', async () => {
    const order: string[] = [];
    await db.scope({ businessId: 'biz' }, async () => {
      await db.tx(async () => {
        await db.afterCommit(() => void order.push('cb'));
      });
      order.push('after-tx');
    });
    expect(order).toEqual(['after-tx', 'cb']);
  });

  it('standalone tx() flushes after its own commit and drops on rollback', async () => {
    const ok = jest.fn();
    const dropped = jest.fn();
    await db.tx(() => db.afterCommit(ok));
    await expect(
      db.tx(async () => {
        await db.afterCommit(dropped);
        throw new Error('x');
      }),
    ).rejects.toThrow('x');
    expect(ok).toHaveBeenCalled();
    expect(dropped).not.toHaveBeenCalled();
  });
});
