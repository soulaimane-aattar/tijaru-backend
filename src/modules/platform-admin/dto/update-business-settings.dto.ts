import { z } from 'zod';

export const UpdateBusinessSettingsSchema = z
  .object({
    multiWarehouse: z.boolean().optional(),
    tvaEnabled: z.boolean().optional(),
  })
  .refine((v) => v.multiWarehouse !== undefined || v.tvaEnabled !== undefined, {
    message: 'At least one setting required',
  });
export type UpdateBusinessSettingsInput = z.infer<typeof UpdateBusinessSettingsSchema>;
