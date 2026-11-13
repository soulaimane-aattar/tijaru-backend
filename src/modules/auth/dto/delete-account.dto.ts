import { z } from 'zod';

export const DeleteAccountSchema = z.object({ password: z.string().min(1) });
export type DeleteAccountInput = z.infer<typeof DeleteAccountSchema>;
