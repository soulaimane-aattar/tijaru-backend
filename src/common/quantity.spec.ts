import { round3, sumQty, zQty, zQtyOrZero } from './quantity';

describe('quantity helpers', () => {
  it('round3 removes float noise', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(round3(0.1 + 0.2)).toBe(0.3);
    expect(round3(1.0004)).toBe(1);
    expect(round3(1.0005)).toBe(1.001);
  });

  it('sumQty rounds the sum', () => {
    expect(sumQty([{ q: 0.1 }, { q: 0.2 }], (r) => r.q)).toBe(0.3);
    expect(sumQty([], (r: { q: number }) => r.q)).toBe(0);
  });

  describe('zQty (> 0, max 3 decimals)', () => {
    it.each([1, 0.001, 1.25, 1234.567, 999_999.999])('accepts %p', (n) => {
      expect(zQty.safeParse(n).success).toBe(true);
    });
    it.each([0, -1, 1.2345, 0.0001, 1_000_000_000, Number.NaN])('rejects %p', (n) => {
      expect(zQty.safeParse(n).success).toBe(false);
    });
  });

  describe('zQtyOrZero (>= 0, max 3 decimals)', () => {
    it('accepts 0 and decimals, rejects negatives and a 4th decimal', () => {
      expect(zQtyOrZero.safeParse(0).success).toBe(true);
      expect(zQtyOrZero.safeParse(2.5).success).toBe(true);
      expect(zQtyOrZero.safeParse(-0.5).success).toBe(false);
      expect(zQtyOrZero.safeParse(2.5001).success).toBe(false);
    });
  });
});
