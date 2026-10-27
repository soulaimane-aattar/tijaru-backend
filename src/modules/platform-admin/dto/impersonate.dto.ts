import { z } from 'zod';

export const ImpersonateSchema = z.object({
  /** Business user to act as. Defaults to the business owner. */
  userId: z.string().min(1).optional(),
});
export type ImpersonateInput = z.infer<typeof ImpersonateSchema>;
