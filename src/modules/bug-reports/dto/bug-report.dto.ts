import { z } from 'zod';

export const CreateBugReportSchema = z.object({
  type: z.enum(['bug', 'suggestion']).default('bug'),
  description: z.string().min(1).max(2000),
  pinX: z.coerce.number().min(0).max(1).optional(),
  pinY: z.coerce.number().min(0).max(1).optional(),
  screen: z.string().max(200).optional(),
  deviceInfo: z.string().max(500).optional(),
  appVersion: z.string().max(50).optional(),
  note: z.string().max(1000).optional(),
  // multipart sends the zone as a JSON string
  zone: z
    .string()
    .transform((v, ctx) => {
      try {
        return JSON.parse(v) as unknown;
      } catch {
        ctx.addIssue({ code: 'custom', message: 'invalid zone JSON' });
        return z.NEVER;
      }
    })
    .pipe(
      z.object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        w: z.number().min(0).max(1),
        h: z.number().min(0).max(1),
      }),
    )
    .optional(),
});

export type CreateBugReportInput = z.infer<typeof CreateBugReportSchema>;
