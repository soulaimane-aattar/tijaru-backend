import { z } from 'zod';

export const ExtendSubscriptionSchema = z.object({
  duration: z.enum(['1mo', '3mo', '6mo', '1yr']),
});
export type ExtendSubscriptionInput = z.infer<typeof ExtendSubscriptionSchema>;
