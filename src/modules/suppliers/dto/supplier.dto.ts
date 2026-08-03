import { z } from 'zod';

export const CreateSupplierSchema = z.object({
  name: z.string().min(1).max(160),
  contact: z.string().max(120).optional(),
  phone: z.string().max(40).optional(),
  city: z.string().max(80).optional(),
  ice: z
    .string()
    .regex(/^\d{15}$/, 'ICE must be 15 digits')
    .optional(),
  email: z.string().email().optional(),
});
export type CreateSupplierInput = z.infer<typeof CreateSupplierSchema>;

export const UpdateSupplierSchema = CreateSupplierSchema.partial();
export type UpdateSupplierInput = z.infer<typeof UpdateSupplierSchema>;
