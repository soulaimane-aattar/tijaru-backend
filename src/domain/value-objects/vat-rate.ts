/** Moroccan TVA rates (spec §3.8). */
export const VAT_RATES = [0, 7, 10, 14, 20] as const;
export type VATRateValue = (typeof VAT_RATES)[number];

export class VATRate {
  private constructor(public readonly value: VATRateValue) {}

  static parse(raw: number): VATRate {
    if (!VAT_RATES.includes(raw as VATRateValue)) {
      throw new Error(`Invalid VAT rate: ${raw}. Allowed: ${VAT_RATES.join(', ')}`);
    }
    return new VATRate(raw as VATRateValue);
  }

  /** Compute TTC from HT amount (in centimes). */
  applyToHT(htCentimes: number): { tvaCentimes: number; ttcCentimes: number } {
    const tvaCentimes = Math.round((htCentimes * this.value) / 100);
    return { tvaCentimes, ttcCentimes: htCentimes + tvaCentimes };
  }
}
