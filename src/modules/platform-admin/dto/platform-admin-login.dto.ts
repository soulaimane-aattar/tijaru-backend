import { z } from 'zod';

export const PlatformAdminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type PlatformAdminLoginInput = z.infer<typeof PlatformAdminLoginSchema>;
