import { z } from 'zod';

export const CreateCustomerSchema = z.object({
  name: z.string().min(1).max(160),
  phone: z.string().max(40).optional(),
  city: z.string().max(80).optional(),
  ice: z
    .string()
    .regex(/^\d{15}$/, 'ICE must be 15 digits')
    .optional(),
  // Credit ceiling for dette alerts. null clears the limit.
  creditLimit: z.number().min(0).nullable().optional(),
  // null = uncategorised.
  categoryId: z.string().min(1).nullable().optional(),
});
export type CreateCustomerInput = z.infer<typeof CreateCustomerSchema>;

export const UpdateCustomerSchema = CreateCustomerSchema.partial();
export type UpdateCustomerInput = z.infer<typeof UpdateCustomerSchema>;

export const ListCustomersQuerySchema = z.object({
  search: z.string().optional(),
});
export type ListCustomersQuery = z.infer<typeof ListCustomersQuerySchema>;

export const CreateCustomerCategorySchema = z.object({
  label: z.string().trim().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'color must be #rrggbb'),
  // Debt ceiling shared by the category's customers. null = no limit.
  creditLimit: z.number().min(0).nullable().optional(),
});
export type CreateCustomerCategoryInput = z.infer<typeof CreateCustomerCategorySchema>;

export const UpdateCustomerCategorySchema = CreateCustomerCategorySchema.partial();
export type UpdateCustomerCategoryInput = z.infer<typeof UpdateCustomerCategorySchema>;
