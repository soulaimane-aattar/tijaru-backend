import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { type Observable, map } from 'rxjs';

import { hasPermission } from '../../domain/permissions';
import type { AuthUser } from '../auth/auth-user.type';

/**
 * Removes the `purchase` (HT cost) field from product payloads when the actor
 * lacks `products.viewPurchasePrice`. Spec §6.2 / §7.6.
 */
@Injectable()
export class StripPurchasePriceInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    const allowed = user ? hasPermission(user, 'products.viewPurchasePrice') : false;
    return next.handle().pipe(map((data) => (allowed ? data : strip(data))));
  }
}

function strip(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(strip);
  if ('items' in value && Array.isArray((value as { items: unknown[] }).items)) {
    return { ...value, items: (value as { items: unknown[] }).items.map(strip) };
  }
  const obj = value as Record<string, unknown>;
  if ('purchase' in obj) {
    const { purchase: _omit, ...rest } = obj;
    void _omit;
    return rest;
  }
  return value;
}
