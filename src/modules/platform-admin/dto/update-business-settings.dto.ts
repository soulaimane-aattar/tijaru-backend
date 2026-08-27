import { z } from 'zod';

/** VAT rates this platform supports (Moroccan set). */
export const KNOWN_VAT_RATES = [0, 7, 10, 14, 20] as const;

export const UpdateBusinessSettingsSchema = z
  .object({
    multiWarehouse: z.boolean().optional(),
    tvaEnabled: z.boolean().optional(),
    /** Exact active-rate set (fine-grained TVA control). */
    enabledVatRates: z.array(z.number().int().min(0).max(100)).min(1).optional(),
    /** Pre-selected rate — must be part of the final enabled set. */
    defaultVatRate: z.number().int().min(0).max(100).optional(),
    /** When false, signing bons is documentary only (no stock movement). */
    bonsAffectStock: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.multiWarehouse !== undefined ||
      v.tvaEnabled !== undefined ||
      v.enabledVatRates !== undefined ||
      v.defaultVatRate !== undefined ||
      v.bonsAffectStock !== undefined,
    { message: 'At least one setting required' },
  );
export type UpdateBusinessSettingsInput = z.infer<typeof UpdateBusinessSettingsSchema>;
