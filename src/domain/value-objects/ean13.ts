/** EAN-13 barcode with checksum validation. */
export class EAN13 {
  private constructor(public readonly value: string) {}

  static parse(raw: string): EAN13 {
    const cleaned = raw.replace(/\s+/g, '');
    if (!/^\d{13}$/.test(cleaned)) {
      throw new Error(`Invalid EAN-13: must be 13 digits, got "${raw}"`);
    }
    if (!EAN13.isChecksumValid(cleaned)) {
      throw new Error(`Invalid EAN-13 checksum: "${raw}"`);
    }
    return new EAN13(cleaned);
  }

  static isChecksumValid(digits: string): boolean {
    const nums = digits.split('').map(Number);
    const check = nums[12]!;
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += nums[i]! * (i % 2 === 0 ? 1 : 3);
    const computed = (10 - (sum % 10)) % 10;
    return computed === check;
  }

  /** Compute checksum digit for a 12-digit prefix (e.g. seed data builder). */
  static checksum(prefix12: string): number {
    if (!/^\d{12}$/.test(prefix12)) throw new Error('EAN-13 prefix must be 12 digits');
    const nums = prefix12.split('').map(Number);
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += nums[i]! * (i % 2 === 0 ? 1 : 3);
    return (10 - (sum % 10)) % 10;
  }

  toString(): string {
    return this.value;
  }
}
