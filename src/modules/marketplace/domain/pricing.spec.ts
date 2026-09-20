import { resolveUnitPrice, type Tier } from './pricing';

const PUBLIC: Tier[] = [
  { priceGroupId: null, minQty: 100, unitPrice: 90 },
  { priceGroupId: null, minQty: 1000, unitPrice: 80 },
];
const GROS: Tier[] = [{ priceGroupId: 'pg_gros', minQty: 100, unitPrice: 85 }];

describe('resolveUnitPrice', () => {
  it('falls back to the listing price below every tier', () => {
    expect(resolveUnitPrice(100, PUBLIC, null, 10)).toBe(100);
  });

  it('picks the highest matching public tier', () => {
    expect(resolveUnitPrice(100, PUBLIC, null, 100)).toBe(90);
    expect(resolveUnitPrice(100, PUBLIC, null, 999)).toBe(90);
    expect(resolveUnitPrice(100, PUBLIC, null, 5000)).toBe(80);
  });

  it('prefers the buyer group tier over the public ladder', () => {
    expect(resolveUnitPrice(100, [...PUBLIC, ...GROS], 'pg_gros', 150)).toBe(85);
  });

  it('falls back to the public ladder when the group has no matching tier', () => {
    expect(resolveUnitPrice(100, [...PUBLIC, ...GROS], 'pg_vip', 150)).toBe(90);
  });

  it('never charges a group more than the public ladder at the same qty', () => {
    // group tier 100→85 matches, but the public 1000→80 step is cheaper
    expect(resolveUnitPrice(100, [...PUBLIC, ...GROS], 'pg_gros', 1000)).toBe(80);
  });

  it('ignores tiers of other groups entirely', () => {
    expect(resolveUnitPrice(100, GROS, 'pg_vip', 500)).toBe(100);
  });

  it('handles an empty ladder', () => {
    expect(resolveUnitPrice(42.5, [], 'pg_gros', 10_000)).toBe(42.5);
  });
});
