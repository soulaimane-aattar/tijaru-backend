import { z } from 'zod';

export const OrderStatusSchema = z.enum([
  'pending',
  'confirmed',
  'in_progress',
  'shipped',
  'delivered',
  'cancelled',
]);
export type OrderStatusInput = z.infer<typeof OrderStatusSchema>;

export const CreateOrderSchema = z.object({
  lines: z
    .array(z.object({ listingId: z.string().cuid(), qty: z.number().int().min(1) }))
    .min(1)
    .max(100),
  note: z.string().max(2000).optional(),
});
export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;

export const TransitionSchema = z.object({
  status: OrderStatusSchema,
  note: z.string().max(2000).optional(),
});
export type TransitionInput = z.infer<typeof TransitionSchema>;

export const ListOrdersQuerySchema = z.object({
  status: OrderStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListOrdersQuery = z.infer<typeof ListOrdersQuerySchema>;
