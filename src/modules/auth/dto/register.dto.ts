import { z } from 'zod';

export const RegisterSchema = z.object({
  businessName: z.string().min(2),
  ownerName: z.string().min(2),
  email: z.string().email(),
  phone: z.string().optional(),
  password: z.string().min(8),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;
