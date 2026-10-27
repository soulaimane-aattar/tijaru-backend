import type { ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';

import { ImpersonationAuditInterceptor } from './impersonation-audit.interceptor';

function run(method: string, user: Record<string, unknown> | undefined) {
  const create = jest.fn().mockResolvedValue({});
  const interceptor = new ImpersonationAuditInterceptor({ platformAuditLog: { create } } as never);
  const ctx = {
    switchToHttp: () => ({ getRequest: () => ({ method, path: '/x', route: { path: '/products/:id' }, user }) }),
  } as unknown as ExecutionContext;
  return lastValueFrom(interceptor.intercept(ctx, { handle: () => of('ok') })).then(() => create);
}

const impersonated = { id: 'u1', role: 'owner', businessId: 'b1', impersonatedBy: 'pa1' };

describe('ImpersonationAuditInterceptor', () => {
  it('journals writes made on an impersonation token', async () => {
    const create = await run('DELETE', impersonated);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'impersonated-write',
        targetId: 'b1',
        targetName: 'DELETE /products/:id',
        detail: 'admin pa1 as owner u1',
      }),
    });
  });

  it('ignores reads and ordinary users', async () => {
    expect(await run('GET', impersonated)).not.toHaveBeenCalled();
    expect(await run('POST', { id: 'u1', role: 'owner', businessId: 'b1' })).not.toHaveBeenCalled();
    expect(await run('POST', undefined)).not.toHaveBeenCalled();
  });
});
