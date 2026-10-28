import { z } from 'zod';

export const ResetPasswordSchema = z.object({
  password: z.string().min(8).optional(),
});
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;
