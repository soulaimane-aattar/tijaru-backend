import { z } from 'zod';

export const UpdateBusinessUserSchema = z
  .object({
    role: z.enum(['owner', 'admin', 'manager', 'stockkeeper', 'cashier', 'viewer']).optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => v.role !== undefined || v.active !== undefined, {
    message: 'At least one field required',
  });
export type UpdateBusinessUserInput = z.infer<typeof UpdateBusinessUserSchema>;
