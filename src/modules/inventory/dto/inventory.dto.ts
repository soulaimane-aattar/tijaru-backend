import { z } from 'zod';

export const StartCountSchema = z.object({
  warehouseId: z.string().cuid(),
  notes: z.string().max(2000).optional(),
});
export type StartCountInput = z.infer<typeof StartCountSchema>;

export const ApplyCountSchema = z.object({
  lines: z
    .array(
      z.object({
        productId: z.string().cuid(),
        counted: z.number().int().min(0),
      }),
    )
    .min(1),
});
export type ApplyCountInput = z.infer<typeof ApplyCountSchema>;
