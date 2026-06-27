/* eslint-disable @typescript-eslint/no-explicit-any */
import { of } from 'rxjs';

import { TenantContext } from './tenant-context';
import { TenantInterceptor } from './tenant.interceptor';

function ctxArg(user: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
}

describe('TenantInterceptor', () => {
  it('runs handler inside tenant scope when businessId present', (done) => {
    const tenant = new TenantContext();
    const interceptor = new TenantInterceptor(tenant);
    let seen: string | undefined;
    const next = { handle: () => { seen = tenant.getBusinessId(); return of('x'); } };
    interceptor.intercept(ctxArg({ businessId: 'biz_9' }), next as any).subscribe(() => {
      expect(seen).toBe('biz_9');
      done();
    });
  });

  it('passes through with no scope when user lacks businessId', (done) => {
    const tenant = new TenantContext();
    const interceptor = new TenantInterceptor(tenant);
    let seen: string | undefined = 'sentinel';
    const next = { handle: () => { seen = tenant.getBusinessId(); return of('x'); } };
    interceptor.intercept(ctxArg(undefined), next as any).subscribe(() => {
      expect(seen).toBeUndefined();
      done();
    });
  });
});
/* eslint-enable @typescript-eslint/no-explicit-any */
