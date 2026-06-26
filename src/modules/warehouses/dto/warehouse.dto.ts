import { z } from 'zod';

export const CreateWarehouseSchema = z.object({
  name: z.string().min(1).max(120),
  city: z.string().min(1).max(80),
  address: z.string().max(240).optional(),
  phone: z.string().max(40).optional(),
  managerId: z.string().cuid().optional(),
  active: z.boolean().default(true),
  isDefault: z.boolean().default(false),
});
export type CreateWarehouseInput = z.infer<typeof CreateWarehouseSchema>;

export const UpdateWarehouseSchema = CreateWarehouseSchema.partial();
export type UpdateWarehouseInput = z.infer<typeof UpdateWarehouseSchema>;
