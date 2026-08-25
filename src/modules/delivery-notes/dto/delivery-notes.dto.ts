import { z } from 'zod';

export const DeliveryNoteTypeSchema = z.enum(['order', 'out', 'in_', 'retour']);
export type DeliveryNoteType = z.infer<typeof DeliveryNoteTypeSchema>;

/** RT (retour) notes are created exclusively through `POST :id/return`. */
export const CreatableDeliveryNoteTypeSchema = z.enum(['order', 'out', 'in_']);

export const DeliveryNoteStatusSchema = z.enum([
  'prepared',
  'sent',
  'shipped',
  'partial',
  'delivered',
  'closed',
]);
export type DeliveryNoteStatus = z.infer<typeof DeliveryNoteStatusSchema>;

export const DeliveryNoteLineInputSchema = z.object({
  productId: z.string().cuid(),
  label: z.string().min(1).max(200),
  ordered: z.number().positive(),
  sent: z.number().min(0).default(0),
  unitPrice: z.number().nonnegative().optional(),
});
export type DeliveryNoteLineInput = z.infer<typeof DeliveryNoteLineInputSchema>;

export const CreateDeliveryNoteSchema = z
  .object({
    type: CreatableDeliveryNoteTypeSchema,
    date: z.coerce.date().optional(),
    customerId: z.string().cuid().optional(),
    supplierId: z.string().cuid().optional(),
    sourceRef: z.string().max(60).optional(),
    carrier: z.string().max(120).optional(),
    notes: z.string().max(2000).optional(),
    status: DeliveryNoteStatusSchema.default('prepared'),
    lines: z.array(DeliveryNoteLineInputSchema).min(1),
  })
  .superRefine((d, ctx) => {
    if (d.type === 'out' && !d.customerId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customerId'],
        message: 'Delivery notes (out) require a customer',
      });
    }
    if ((d.type === 'in_' || d.type === 'order') && !d.supplierId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['supplierId'],
        message: 'Purchase / receipt notes require a supplier',
      });
    }
  });
export type CreateDeliveryNoteInput = z.infer<typeof CreateDeliveryNoteSchema>;

export const UpdateSentSchema = z.object({
  lineId: z.string().cuid(),
  sent: z.number().min(0),
});
export type UpdateSentInput = z.infer<typeof UpdateSentSchema>;

export const SignSchema = z.object({});
export type SignInput = z.infer<typeof SignSchema>;

/** Object wrapper so the body survives the global class-validator whitelist pipe. */
export const SetStatusSchema = z.object({
  status: DeliveryNoteStatusSchema,
});
export type SetStatusInput = z.infer<typeof SetStatusSchema>;

export const BonPaymentMethodSchema = z.enum(['cash', 'card', 'transfer', 'other']);
export type BonPaymentMethod = z.infer<typeof BonPaymentMethodSchema>;

export const AddPaymentSchema = z.object({
  amount: z.number().positive(),
  method: BonPaymentMethodSchema.default('cash'),
  note: z.string().max(500).optional(),
});
export type AddPaymentInput = z.infer<typeof AddPaymentSchema>;

export const CreateReturnSchema = z.object({
  lines: z
    .array(
      z.object({
        lineId: z.string().cuid(),
        qty: z.number().positive(),
      }),
    )
    .min(1),
  notes: z.string().max(2000).optional(),
});
export type CreateReturnInput = z.infer<typeof CreateReturnSchema>;

export const ListDeliveryNotesQuerySchema = z.object({
  type: DeliveryNoteTypeSchema.optional(),
  status: DeliveryNoteStatusSchema.optional(),
  partyId: z.string().cuid().optional(),
  search: z.string().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListDeliveryNotesQuery = z.infer<typeof ListDeliveryNotesQuerySchema>;
