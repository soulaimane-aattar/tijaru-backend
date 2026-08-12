import { z } from 'zod';

/**
 * User-facing adjustment reasons. Wider than Prisma's `MovementReason` enum
 * (achat|vente|transfert|peremption|ajustement|casse) — the service maps each
 * value to the closest DB reason and keeps the original in the movement `ref`
 * for audit clarity (see `mapAdjustReason` in products.service.ts).
 */
export const ADJUST_REASONS = ['ecart', 'casse', 'perime', 'vol', 'retour'] as const;

export const AdjustProductSchema = z.object({
  warehouseId: z.string().cuid(),
  delta: z.number().int(),
  reason: z.enum(ADJUST_REASONS),
  note: z.string().max(2000).optional(),
});
export type AdjustProductInput = z.infer<typeof AdjustProductSchema>;
