import { z } from 'zod';

export const EXPENSE_CATEGORIES = [
  'rent',
  'utilities',
  'salaries',
  'supplies',
  'transport',
  'maintenance',
  'taxes',
  'marketing',
  'other',
] as const;

export const PAYMENT_METHODS = ['cash', 'card', 'credit', 'split'] as const;

export const CreateExpenseSchema = z.object({
  date: z.coerce.date(),
  amount: z.number().positive().max(99_999_999),
  taxAmount: z.number().min(0).max(99_999_999).optional(),
  category: z.enum(EXPENSE_CATEGORIES).default('other'),
  supplierId: z.string().cuid().optional(),
  warehouseId: z.string().cuid().optional(),
  merchantName: z.string().max(160).optional(),
  note: z.string().max(1000).optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).default('cash'),
  /** Relative path returned by `POST /expenses/scan`. */
  receiptPath: z.string().max(300).optional(),
  /** sha256 of the receipt bytes, returned by `POST /expenses/scan`. */
  receiptHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});
export type CreateExpenseInput = z.infer<typeof CreateExpenseSchema>;

export const UpdateExpenseSchema = CreateExpenseSchema.partial();
export type UpdateExpenseInput = z.infer<typeof UpdateExpenseSchema>;

export const ListExpensesSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  category: z.enum(EXPENSE_CATEGORIES).optional(),
});
export type ListExpensesQuery = z.infer<typeof ListExpensesSchema>;
