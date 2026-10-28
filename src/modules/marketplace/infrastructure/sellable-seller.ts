import { sql } from 'kysely';

/**
 * A seller only trades while it can actually fulfil: active business, live
 * subscription, marketplace module still enabled. Applied to the catalog and
 * to order creation, so a suspended tenant cannot collect orders it is then
 * blocked (by SubscriptionGuard) from shipping.
 *
 * `b` = alias of the joined `app.businesses` table.
 */
export const sellableSeller = (b: string) => sql<boolean>`(
  ${sql.ref(`${b}.status`)} = 'active'
  and ${sql.ref(`${b}.plan`)} in ('trial', 'active')
  and exists (
    select 1 from app.business_modules m
    where m.business_id = ${sql.ref(`${b}.id`)} and m.module_id = 'marketplace' and m.active
  )
)`;
