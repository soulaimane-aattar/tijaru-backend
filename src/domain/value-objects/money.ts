/**
 * Money — MAD-only for now; stored as integer centimes to avoid float drift.
 * 1 MAD = 100 centimes.
 */
export class Money {
  private constructor(public readonly centimes: number) {}

  static fromMAD(amount: number): Money {
    if (!Number.isFinite(amount)) throw new Error('Money: amount must be finite');
    return new Money(Math.round(amount * 100));
  }

  static fromCentimes(centimes: number): Money {
    if (!Number.isInteger(centimes)) throw new Error('Money: centimes must be integer');
    return new Money(centimes);
  }

  get mad(): number {
    return this.centimes / 100;
  }

  add(other: Money): Money {
    return new Money(this.centimes + other.centimes);
  }

  sub(other: Money): Money {
    return new Money(this.centimes - other.centimes);
  }

  mul(factor: number): Money {
    return new Money(Math.round(this.centimes * factor));
  }

  isNegative(): boolean {
    return this.centimes < 0;
  }

  equals(other: Money): boolean {
    return this.centimes === other.centimes;
  }
}
