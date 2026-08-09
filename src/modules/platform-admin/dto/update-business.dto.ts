import { z } from 'zod';

export const UpdateBusinessSchema = z.object({
  maxUsers: z.number().int().min(1).optional(),
  maxProducts: z.number().int().min(1).optional(),
  maxWarehouses: z.number().int().min(1).optional(),
});
export type UpdateBusinessInput = z.infer<typeof UpdateBusinessSchema>;
