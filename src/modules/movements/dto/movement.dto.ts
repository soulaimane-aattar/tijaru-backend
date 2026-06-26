import { z } from 'zod';

export const MovementTypeEnum = z.enum(['in', 'out', 'transfer']);
export type MovementTypeValue = z.infer<typeof MovementTypeEnum>;

export const MovementReasonEnum = z.enum([
  'achat',
  'vente',
  'transfert',
  'peremption',
  'ajustement',
  'casse',
]);
export type MovementReasonValue = z.infer<typeof MovementReasonEnum>;

export const CreateMovementSchema = z
  .object({
    type: MovementTypeEnum,
    productId: z.string().cuid(),
    qty: z.number().int().positive(),
    warehouseId: z.string().cuid(),
    toWarehouseId: z.string().cuid().optional(),
    reason: MovementReasonEnum,
    ref: z.string().max(80).optional(),
    batch: z.string().max(80).optional(),
    expiry: z.coerce.date().optional(),
    date: z.coerce.date().optional(),
  })
  .superRefine((m, ctx) => {
    if (m.type === 'transfer') {
      if (!m.toWarehouseId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['toWarehouseId'],
          message: 'Required for transfer',
        });
      } else if (m.toWarehouseId === m.warehouseId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['toWarehouseId'],
          message: 'Source and destination must differ',
        });
      }
    } else if (m.toWarehouseId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['toWarehouseId'],
        message: 'Only allowed for transfer',
      });
    }
  });
export type CreateMovementInput = z.infer<typeof CreateMovementSchema>;

export const ListMovementsQuerySchema = z.object({
  type: MovementTypeEnum.optional(),
  productId: z.string().cuid().optional(),
  warehouseId: z.string().cuid().optional(),
  userId: z.string().cuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListMovementsQuery = z.infer<typeof ListMovementsQuerySchema>;
