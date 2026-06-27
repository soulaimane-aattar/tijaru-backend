// src/common/tenant/tenant.middleware.spec.ts
import { TenantContext } from './tenant-context';
import { makeTenantMiddleware } from './tenant.middleware';

interface MiddlewareParams {
  model: string;
  action: string;
  args: Record<string, unknown>;
}

function call(mw: ReturnType<typeof makeTenantMiddleware>, params: MiddlewareParams) {
  let received: MiddlewareParams | undefined;
  const next = (p: MiddlewareParams) => {
    received = p;
    return Promise.resolve('ok');
  };
  return mw(params as Parameters<typeof mw>[0], next as Parameters<typeof mw>[1]).then(
    () => received,
  );
}

describe('tenant middleware', () => {
  const ctx = new TenantContext();
  const mw = makeTenantMiddleware(ctx);

  it('injects where.businessId on findMany inside a tenant scope', async () => {
    const out = await ctx.run('biz_1', () =>
      call(mw, { model: 'Product', action: 'findMany', args: { where: { name: 'x' } } }),
    );
    expect((out?.args as Record<string, unknown>).where).toEqual({
      name: 'x',
      businessId: 'biz_1',
    });
  });

  it('sets data.businessId on create', async () => {
    const out = await ctx.run('biz_1', () =>
      call(mw, { model: 'Product', action: 'create', args: { data: { name: 'x' } } }),
    );
    expect((out?.args.data as Record<string, unknown>).businessId).toBe('biz_1');
  });

  it('rewrites findUnique to findFirst with businessId', async () => {
    const out = await ctx.run('biz_1', () =>
      call(mw, { model: 'Product', action: 'findUnique', args: { where: { id: 'p1' } } }),
    );
    expect(out?.action).toBe('findFirst');
    expect((out?.args as Record<string, unknown>).where).toEqual({
      id: 'p1',
      businessId: 'biz_1',
    });
  });

  it('does NOT touch non-tenant models', async () => {
    const out = await ctx.run('biz_1', () =>
      call(mw, { model: 'Business', action: 'findMany', args: {} }),
    );
    expect((out?.args as Record<string, unknown>).where).toBeUndefined();
  });

  it('is a no-op outside any tenant scope (platform path)', async () => {
    const out = await call(mw, { model: 'Product', action: 'findMany', args: {} });
    expect((out?.args as Record<string, unknown>).where).toBeUndefined();
  });
});
