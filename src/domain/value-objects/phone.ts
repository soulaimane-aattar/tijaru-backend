/** Moroccan phone (spec §3.8: "+212 6XX XX XX XX"). Accepts 0XXXXXXXXX, +212XXXXXXXXX, or 212XXXXXXXXX. */
export class Phone {
  private constructor(public readonly e164: string) {}

  static parse(raw: string): Phone {
    const cleaned = raw.replace(/[\s().-]/g, '');
    let digits: string;
    if (/^\+212\d{9}$/.test(cleaned)) digits = cleaned.slice(4);
    else if (/^212\d{9}$/.test(cleaned)) digits = cleaned.slice(3);
    else if (/^0\d{9}$/.test(cleaned)) digits = cleaned.slice(1);
    else throw new Error(`Invalid Moroccan phone: "${raw}"`);
    return new Phone(`+212${digits}`);
  }

  /** Display form: "+212 6XX XX XX XX". */
  format(): string {
    const n = this.e164.slice(4);
    return `+212 ${n.slice(0, 3)} ${n.slice(3, 5)} ${n.slice(5, 7)} ${n.slice(7, 9)}`;
  }

  toString(): string {
    return this.e164;
  }
}
