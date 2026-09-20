import type { HttpException } from '@nestjs/common';

import { allowedNext, assertTransition, canTransition } from './order-state-machine';

/** DomainError puts the machine-readable bits in the response body. */
const codeOf = (fn: () => void): string => {
  try {
    fn();
  } catch (e) {
    return ((e as HttpException).getResponse() as { code: string }).code;
  }
  throw new Error('expected a throw');
};

describe('order state machine', () => {
  it('walks the happy path', () => {
    expect(canTransition('pending', 'confirmed')).toBe(true);
    expect(canTransition('confirmed', 'in_progress')).toBe(true);
    expect(canTransition('in_progress', 'shipped')).toBe(true);
    expect(canTransition('shipped', 'delivered')).toBe(true);
  });

  it('refuses skips and reversals', () => {
    expect(canTransition('pending', 'shipped')).toBe(false);
    expect(canTransition('delivered', 'shipped')).toBe(false);
    expect(canTransition('cancelled', 'confirmed')).toBe(false);
    expect(codeOf(() => assertTransition('pending', 'delivered', 'seller'))).toBe(
      'invalid_transition',
    );
  });

  it('refuses cancelling once shipped', () => {
    expect(canTransition('shipped', 'cancelled')).toBe(false);
  });

  it('lets a buyer cancel only while pending', () => {
    expect(() => assertTransition('pending', 'cancelled', 'buyer')).not.toThrow();
    expect(codeOf(() => assertTransition('confirmed', 'cancelled', 'buyer'))).toBe('forbidden');
    expect(codeOf(() => assertTransition('pending', 'confirmed', 'buyer'))).toBe('forbidden');
  });

  it('offers actor-specific next states', () => {
    expect(allowedNext('pending', 'seller')).toEqual(['confirmed', 'cancelled']);
    expect(allowedNext('pending', 'buyer')).toEqual(['cancelled']);
    expect(allowedNext('confirmed', 'buyer')).toEqual([]);
    expect(allowedNext('delivered', 'seller')).toEqual([]);
  });
});
