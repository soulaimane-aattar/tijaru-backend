import { z } from 'zod';

export const PlatformAdminMfaSchema = z.object({
  mfaToken: z.string().min(10),
  code: z.string().regex(/^\d{6}$/),
});
export type PlatformAdminMfaInput = z.infer<typeof PlatformAdminMfaSchema>;
