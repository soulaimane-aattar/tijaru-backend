import { z } from 'zod';

export const InvoiceStatusSchema = z.enum([
  'draft',
  'sent',
  'partial',
  'paid',
  'overdue',
  'cancelled',
]);
export type InvoiceStatus = z.infer<typeof InvoiceStatusSchema>;

export const InvoiceLineInputSchema = z.object({
  productId: z.string().cuid(),
  label: z.string().min(1).max(200),
  qty: z.number().positive(),
  priceHt: z.number().min(0),
  vat: z.number().int().min(0).max(100),
  discount: z.number().min(0).default(0),
});
export type InvoiceLineInput = z.infer<typeof InvoiceLineInputSchema>;

export const CreateInvoiceSchema = z.object({
  customerId: z.string().cuid(),
  date: z.coerce.date().optional(),
  dueDate: z.coerce.date(),
  lines: z.array(InvoiceLineInputSchema).min(1),
  discount: z.number().min(0).default(0),
  notes: z.string().max(2000).optional(),
  terms: z.string().max(2000).optional(),
  status: InvoiceStatusSchema.default('draft'),
});
export type CreateInvoiceInput = z.infer<typeof CreateInvoiceSchema>;

export const UpdateInvoiceSchema = CreateInvoiceSchema.partial().extend({
  status: InvoiceStatusSchema.optional(),
});
export type UpdateInvoiceInput = z.infer<typeof UpdateInvoiceSchema>;

export const RecordPaymentSchema = z.object({
  amount: z.number().positive(),
});
export type RecordPaymentInput = z.infer<typeof RecordPaymentSchema>;

export const ListInvoicesQuerySchema = z.object({
  status: InvoiceStatusSchema.optional(),
  customerId: z.string().cuid().optional(),
  search: z.string().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListInvoicesQuery = z.infer<typeof ListInvoicesQuerySchema>;
