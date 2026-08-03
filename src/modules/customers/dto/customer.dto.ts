import { z } from 'zod';

export const CreateCustomerSchema = z.object({
  name: z.string().min(1).max(160),
  phone: z.string().max(40).optional(),
  city: z.string().max(80).optional(),
  ice: z
    .string()
    .regex(/^\d{15}$/, 'ICE must be 15 digits')
    .optional(),
});
export type CreateCustomerInput = z.infer<typeof CreateCustomerSchema>;

export const UpdateCustomerSchema = CreateCustomerSchema.partial();
export type UpdateCustomerInput = z.infer<typeof UpdateCustomerSchema>;

export const ListCustomersQuerySchema = z.object({
  search: z.string().optional(),
});
export type ListCustomersQuery = z.infer<typeof ListCustomersQuerySchema>;
