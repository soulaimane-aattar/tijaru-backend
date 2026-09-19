import { AsyncLocalStorage } from 'node:async_hooks';

import { Injectable } from '@nestjs/common';

/** Prisma model names that carry businessId and are auto-scoped. */
export const TENANT_MODELS: ReadonlySet<string> = new Set([
  'Warehouse',
  'User',
  'CustomRole',
  'RoleCustomization',
  'SecurityPolicy',
  'Category',
  'Supplier',
  'Customer',
  'Product',
  'StockLevel',
  'Movement',
  'PurchaseOrder',
  'POSession',
  'POTicket',
  'InventoryCount',
  'Notification',
  'Activity',
  'BusinessModule',
  'Expense',
  'ExpenseCategoryDef',
  'Attendance',
  'AttendancePause',
  'Estimate',
  'EstimateLine',
]);

type Store = { businessId: string };

@Injectable()
export class TenantContext {
  private readonly als = new AsyncLocalStorage<Store>();

  run<T>(businessId: string, fn: () => T): T {
    return this.als.run({ businessId }, fn);
  }

  /**
   * Run `fn` with no tenant scope, so the middleware leaves its queries alone.
   * Only for deliberately cross-tenant work (marketplace, D-030): the caller is
   * then responsible for filtering on businessId itself.
   */
  runUnscoped<T>(fn: () => T): T {
    return this.als.exit(fn);
  }

  getBusinessId(): string | undefined {
    return this.als.getStore()?.businessId;
  }
}
