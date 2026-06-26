import { z } from 'zod';

export const PaymentSchema = z.discriminatedUnion('method', [
  z.object({
    method: z.literal('cash'),
    tendered: z.number().min(0),
  }),
  z.object({
    method: z.literal('card'),
  }),
  z.object({
    method: z.literal('credit'),
    customerId: z.string().cuid(),
  }),
  z.object({
    method: z.literal('split'),
    cash: z.number().min(0),
    card: z.number().min(0),
  }),
]);
export type PaymentInput = z.infer<typeof PaymentSchema>;

export const TicketLineSchema = z.object({
  productId: z.string().cuid(),
  qty: z.number().int().positive(),
});
export type TicketLineInput = z.infer<typeof TicketLineSchema>;

export const CreateTicketSchema = z
  .object({
    warehouseId: z.string().cuid(),
    customerId: z.string().cuid().optional(),
    lines: z.array(TicketLineSchema).min(1),
    discount: z.number().min(0).default(0),
    payment: PaymentSchema,
    parked: z.boolean().default(false),
  })
  .superRefine((t, ctx) => {
    if (t.payment.method === 'credit' && !t.customerId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customerId'],
        message: 'Credit payment requires a customer',
      });
    }
    if (t.payment.method === 'credit' && t.payment.customerId !== t.customerId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payment', 'customerId'],
        message: 'Payment customer must match ticket customer',
      });
    }
  });
export type CreateTicketInput = z.infer<typeof CreateTicketSchema>;

export const OpenSessionSchema = z.object({
  openingFloat: z.number().min(0).default(0),
});
export type OpenSessionInput = z.infer<typeof OpenSessionSchema>;
