import { TenantContext, TENANT_MODELS } from './tenant-context';

describe('TenantContext', () => {
  it('returns undefined outside any scope', () => {
    const ctx = new TenantContext();
    expect(ctx.getBusinessId()).toBeUndefined();
  });

  it('exposes businessId inside run() and clears after', () => {
    const ctx = new TenantContext();
    const inside = ctx.run('biz_1', () => ctx.getBusinessId());
    expect(inside).toBe('biz_1');
    expect(ctx.getBusinessId()).toBeUndefined();
  });

  it('isolates nested scopes', () => {
    const ctx = new TenantContext();
    const seen = ctx.run('outer', () => ctx.run('inner', () => ctx.getBusinessId()));
    expect(seen).toBe('inner');
  });

  it('lists Product as tenant-scoped and Business as not', () => {
    expect(TENANT_MODELS.has('Product')).toBe(true);
    expect(TENANT_MODELS.has('Business')).toBe(false);
    expect(TENANT_MODELS.has('PlatformAdmin')).toBe(false);
  });

  it('auto-scopes the Expense model', () => {
    expect(TENANT_MODELS.has('Expense')).toBe(true);
  });
});
