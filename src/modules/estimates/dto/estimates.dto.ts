import { z } from 'zod';

export const EstimateStatusSchema = z.enum([
  'draft',
  'sent',
  'accepted',
  'rejected',
  'expired',
  'cancelled',
]);
export type EstimateStatus = z.infer<typeof EstimateStatusSchema>;

export const EstimateLineInputSchema = z.object({
  productId: z.string().cuid(),
  label: z.string().min(1).max(200),
  qty: z.number().positive(),
  priceHt: z.number().min(0),
  vat: z.number().int().min(0).max(100),
  discount: z.number().min(0).default(0),
});
export type EstimateLineInput = z.infer<typeof EstimateLineInputSchema>;

export const CreateEstimateSchema = z.object({
  customerId: z.string().cuid(),
  date: z.coerce.date().optional(),
  validUntil: z.coerce.date(),
  lines: z.array(EstimateLineInputSchema).min(1),
  discount: z.number().min(0).default(0),
  notes: z.string().max(2000).optional(),
  terms: z.string().max(2000).optional(),
});
export type CreateEstimateInput = z.infer<typeof CreateEstimateSchema>;

export const UpdateEstimateSchema = CreateEstimateSchema.partial().extend({
  status: EstimateStatusSchema.optional(),
});
export type UpdateEstimateInput = z.infer<typeof UpdateEstimateSchema>;

export const ListEstimatesQuerySchema = z.object({
  status: EstimateStatusSchema.optional(),
  customerId: z.string().cuid().optional(),
  search: z.string().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListEstimatesQuery = z.infer<typeof ListEstimatesQuerySchema>;
