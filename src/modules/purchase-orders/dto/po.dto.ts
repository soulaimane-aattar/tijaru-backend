import { z } from 'zod';

import { zQty } from '../../../common/quantity';

const VatEnum = z.union([z.literal(0), z.literal(7), z.literal(10), z.literal(14), z.literal(20)]);

const POLineSchema = z.object({
  productId: z.string().cuid(),
  qty: zQty,
  price: z.number().min(0),
  vat: VatEnum,
});

export const CreatePOSchema = z.object({
  supplierId: z.string().cuid(),
  warehouseId: z.string().cuid(),
  lines: z.array(POLineSchema).min(1),
  notes: z.string().max(2000).optional(),
  status: z.enum(['draft', 'sent']).default('draft'),
});
export type CreatePOInput = z.infer<typeof CreatePOSchema>;

export const PatchPOSchema = z.object({
  status: z.enum(['draft', 'sent', 'cancelled']).optional(),
  notes: z.string().max(2000).optional(),
  // Draft-only edits (service enforces the status rule):
  supplierId: z.string().cuid().optional(),
  warehouseId: z.string().cuid().optional(),
  lines: z.array(POLineSchema).min(1).optional(),
});
export type PatchPOInput = z.infer<typeof PatchPOSchema>;

export const ReceivePOSchema = z.object({
  lines: z
    .array(
      z.object({
        lineId: z.string().cuid(),
        qty: zQty,
      }),
    )
    .min(1),
});
export type ReceivePOInput = z.infer<typeof ReceivePOSchema>;

export const ListPOQuerySchema = z.object({
  status: z.enum(['draft', 'sent', 'partiallyReceived', 'received', 'cancelled']).optional(),
  supplierId: z.string().cuid().optional(),
  warehouseId: z.string().cuid().optional(),
});
export type ListPOQuery = z.infer<typeof ListPOQuerySchema>;
