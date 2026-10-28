import type { ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';

import { fakeDb } from '../testing/db-fake';

import { ImpersonationAuditInterceptor } from './impersonation-audit.interceptor';

function run(method: string, user: Record<string, unknown> | undefined) {
  const { db, calls } = fakeDb();
  const interceptor = new ImpersonationAuditInterceptor(db);
  const ctx = {
    switchToHttp: () => ({ getRequest: () => ({ method, path: '/x', route: { path: '/products/:id' }, user }) }),
  } as unknown as ExecutionContext;
  return lastValueFrom(interceptor.intercept(ctx, { handle: () => of('ok') })).then(() => calls.filter((c) => c.op === 'insert'));
}

const impersonated = { id: 'u1', role: 'owner', businessId: 'b1', impersonatedBy: 'pa1' };

describe('ImpersonationAuditInterceptor', () => {
  it('journals writes made on an impersonation token', async () => {
    const [insert] = await run('DELETE', impersonated);
    expect(insert!.table).toBe('platform_audit_logs');
    expect(insert!.values).toEqual(
      expect.objectContaining({
        action: 'impersonated-write',
        target_id: 'b1',
        target_name: 'DELETE /products/:id',
        detail: 'admin pa1 as owner u1',
      }),
    );
  });

  it('ignores reads and ordinary users', async () => {
    expect(await run('GET', impersonated)).toHaveLength(0);
    expect(await run('POST', { id: 'u1', role: 'owner', businessId: 'b1' })).toHaveLength(0);
    expect(await run('POST', undefined)).toHaveLength(0);
  });
});
