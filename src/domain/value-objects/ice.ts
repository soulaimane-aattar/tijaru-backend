/** Identifiant Commun de l'Entreprise — 15 numeric digits (spec §3.8). */
export class ICE {
  private constructor(public readonly value: string) {}

  static parse(raw: string): ICE {
    const cleaned = raw.replace(/\s+/g, '');
    if (!/^\d{15}$/.test(cleaned)) {
      throw new Error(`Invalid ICE: must be exactly 15 digits, got "${raw}"`);
    }
    return new ICE(cleaned);
  }

  /** Display form with NBSP grouping every 5 digits (e.g. "00151 23450 00078"). */
  format(): string {
    return `${this.value.slice(0, 5)} ${this.value.slice(5, 10)} ${this.value.slice(10, 15)}`;
  }

  toString(): string {
    return this.value;
  }
}
