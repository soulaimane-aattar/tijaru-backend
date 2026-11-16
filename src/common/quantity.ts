import { type Expression, sql } from 'kysely';
import { z } from 'zod';

/**
 * Quantities (stock, movements, PO / POS / count lines) are `double precision`
 * with at most 3 decimals — 1.250 kg (migration 011). Doubles can't represent
 * most decimals exactly, so: round after every addition/subtraction, before
 * comparing or storing. Never compare raw sums (0.1 + 0.2 > 0.3 is true).
 */
export const QTY_DECIMALS = 3;

export const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Sum of quantities, rounded. */
export const sumQty = <T>(rows: readonly T[], pick: (row: T) => number): number =>
  round3(rows.reduce((s, r) => s + pick(r), 0));

/**
 * SQL `column + delta`, rounded to 3 decimals — use for every in-place
 * quantity update so stored values stay exact 3-decimal doubles.
 */
export const roundedSum = (column: Expression<number>, delta: number) =>
  sql<number>`round((${column} + ${delta})::numeric, 3)::float8`;

const max3Decimals = (n: number) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6;
const msg = { message: 'At most 3 decimals' };

/** Quantity > 0, at most 3 decimals. */
export const zQty = z.number().positive().max(999_999_999).refine(max3Decimals, msg);
/** Quantity ≥ 0, at most 3 decimals (stock levels, counts, thresholds). */
export const zQtyOrZero = z.number().min(0).max(999_999_999).refine(max3Decimals, msg);
