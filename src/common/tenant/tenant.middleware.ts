// src/common/tenant/tenant.middleware.ts
import type { Prisma } from '@prisma/client';

import { TENANT_MODELS, type TenantContext } from './tenant-context';

const READ_ACTIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
  'update',
  'delete',
  'upsert',
]);

export function makeTenantMiddleware(ctx: TenantContext): Prisma.Middleware {
  return async (params, next) => {
    const businessId = ctx.getBusinessId();
    if (!businessId || !params.model || !TENANT_MODELS.has(params.model)) {
      return next(params);
    }

    // findUnique can only filter on unique fields → rewrite to findFirst.
    if (params.action === 'findUnique' || params.action === 'findUniqueOrThrow') {
      params.action = params.action === 'findUnique' ? 'findFirst' : 'findFirstOrThrow';
    }

    params.args = params.args ?? {};

    if (params.action === 'create') {
      params.args.data = { ...params.args.data, businessId };
      return next(params);
    }
    if (params.action === 'createMany') {
      const data = params.args.data;
      params.args.data = Array.isArray(data)
        ? data.map((d: Record<string, unknown>) => ({ ...d, businessId }))
        : { ...data, businessId };
      return next(params);
    }
    if (params.action === 'upsert') {
      params.args.where = { ...params.args.where, businessId };
      params.args.create = { ...params.args.create, businessId };
      return next(params);
    }
    if (READ_ACTIONS.has(params.action)) {
      params.args.where = { ...params.args.where, businessId };
      return next(params);
    }
    return next(params);
  };
}
