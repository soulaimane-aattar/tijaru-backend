import { z } from 'zod';

export const UpdateBugReportStatusSchema = z.object({
  status: z.enum(['open', 'acknowledged', 'resolved']),
});
