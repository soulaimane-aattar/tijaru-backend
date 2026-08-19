import { z } from 'zod';

const CategoryKey = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, 'key must be lowercase slug');

const Label = z.string().trim().min(1).max(80);
const TaxRate = z.number().min(0).max(100);
const SortOrder = z.number().int().min(0).max(10_000);

export const CreateExpenseCategorySchema = z.object({
  key: CategoryKey,
  label: Label,
  taxRate: TaxRate.default(20),
  sortOrder: SortOrder.default(0),
});
export type CreateExpenseCategoryInput = z.infer<typeof CreateExpenseCategorySchema>;

export const UpdateExpenseCategorySchema = z.object({
  label: Label.optional(),
  taxRate: TaxRate.optional(),
  sortOrder: SortOrder.optional(),
  archived: z.boolean().optional(),
});
export type UpdateExpenseCategoryInput = z.infer<typeof UpdateExpenseCategorySchema>;

export const ListExpenseCategoriesSchema = z.object({
  includeArchived: z
    .union([z.boolean(), z.literal('true'), z.literal('false')])
    .transform((v) => v === true || v === 'true')
    .optional(),
});
export type ListExpenseCategoriesQuery = z.infer<typeof ListExpenseCategoriesSchema>;
