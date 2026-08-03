import { z } from 'zod';

export const ListActivityQuerySchema = z.object({
  userId: z.string().cuid().optional(),
  action: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListActivityQuery = z.infer<typeof ListActivityQuerySchema>;
