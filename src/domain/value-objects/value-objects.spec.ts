import { describe, expect, it } from '@jest/globals';

import { EAN13 } from './ean13';
import { ICE } from './ice';
import { Money } from './money';
import { Phone } from './phone';
import { VATRate } from './vat-rate';

describe('ICE', () => {
  it('accepts 15 digits', () => {
    expect(ICE.parse('001512345000078').value).toBe('001512345000078');
  });
  it('strips whitespace', () => {
    expect(ICE.parse('00151 23450 00078').value).toBe('001512345000078');
  });
  it('formats with NBSP-like spaces grouped by 5', () => {
    expect(ICE.parse('001512345000078').format()).toBe('00151 23450 00078');
  });
  it('rejects non-15-digit', () => {
    expect(() => ICE.parse('123')).toThrow();
    expect(() => ICE.parse('0015123450000789')).toThrow();
    expect(() => ICE.parse('00151234500007a')).toThrow();
  });
});

describe('EAN13', () => {
  it('validates a known-good code', () => {
    // 6111111000018 — checksum computed
    const prefix = '611111100001';
    const check = EAN13.checksum(prefix);
    const code = prefix + check;
    expect(() => EAN13.parse(code)).not.toThrow();
  });
  it('rejects invalid checksum', () => {
    expect(() => EAN13.parse('6111111000010')).toThrow();
  });
  it('rejects non-13-digit', () => {
    expect(() => EAN13.parse('123')).toThrow();
  });
});

describe('Money', () => {
  it('rounds to centimes', () => {
    expect(Money.fromMAD(12.345).centimes).toBe(1235);
    expect(Money.fromMAD(12.344).centimes).toBe(1234);
  });
  it('arithmetic stays in centimes', () => {
    const a = Money.fromMAD(10);
    const b = Money.fromMAD(2.5);
    expect(a.add(b).mad).toBe(12.5);
    expect(a.sub(b).mad).toBe(7.5);
    expect(a.mul(0.1).centimes).toBe(100);
  });
});

describe('VATRate', () => {
  it('accepts Moroccan rates 0/7/10/14/20', () => {
    for (const r of [0, 7, 10, 14, 20]) expect(VATRate.parse(r).value).toBe(r);
  });
  it('rejects other rates', () => {
    expect(() => VATRate.parse(19)).toThrow();
    expect(() => VATRate.parse(21)).toThrow();
  });
  it('applies to HT', () => {
    const v = VATRate.parse(20);
    const { tvaCentimes, ttcCentimes } = v.applyToHT(10000);
    expect(tvaCentimes).toBe(2000);
    expect(ttcCentimes).toBe(12000);
  });
});

describe('Phone', () => {
  it('accepts 0XXXXXXXXX', () => {
    expect(Phone.parse('0612345678').e164).toBe('+212612345678');
  });
  it('accepts +212XXXXXXXXX', () => {
    expect(Phone.parse('+212612345678').e164).toBe('+212612345678');
  });
  it('formats with grouped digits', () => {
    expect(Phone.parse('0612345678').format()).toBe('+212 612 34 56 78');
  });
  it('rejects garbage', () => {
    expect(() => Phone.parse('abc')).toThrow();
  });
});
