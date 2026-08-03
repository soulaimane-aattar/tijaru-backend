import { z } from 'zod';

export const DaysQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});
export type DaysQuery = z.infer<typeof DaysQuerySchema>;
