import type { Prisma } from '@prisma/client';

/**
 * A seller only trades while it can actually fulfil: active business, live
 * subscription, marketplace module still enabled. Applied to the catalog and
 * to order creation, so a suspended tenant cannot collect orders it is then
 * blocked (by SubscriptionGuard) from shipping.
 */
export const SELLABLE_SELLER: Prisma.BusinessWhereInput = {
  status: 'active',
  plan: { in: ['trial', 'active'] },
  modules: { some: { moduleId: 'marketplace', active: true } },
};
