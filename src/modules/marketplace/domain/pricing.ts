/**
 * Quantity-tier price resolution.
 *
 * Semantics copied from Odoo `product.pricelist.item` (`addons/product/models/
 * product_pricelist_item.py`): items are ordered by `min_quantity desc` and the
 * first rule whose `min_quantity <= qty` wins. Two ladders are consulted — the
 * buyer's price group and the public one — and the cheaper match wins, so a
 * discounted group never pays more than a walk-in buyer at the same quantity.
 * With no match at all, the listing's own `unitPrice` applies.
 *
 * `minQty` is a real column (not a JSON rule) on purpose — medusajs/medusa#16463
 * shows what happens when a tier hides inside a generic rules blob.
 */

export type Tier = {
  priceGroupId: string | null;
  minQty: number;
  unitPrice: number;
};

export function resolveUnitPrice(
  listingPrice: number,
  tiers: readonly Tier[],
  priceGroupId: string | null,
  qty: number,
): number {
  const best = (scope: string | null): Tier | undefined =>
    tiers
      .filter((t) => t.priceGroupId === scope && t.minQty <= qty)
      .sort((a, b) => b.minQty - a.minQty)[0];

  const candidates = [priceGroupId ? best(priceGroupId) : undefined, best(null)]
    .filter((t): t is Tier => t !== undefined)
    .map((t) => t.unitPrice);

  return candidates.length ? Math.min(...candidates) : listingPrice;
}
