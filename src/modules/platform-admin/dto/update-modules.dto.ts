import { z } from 'zod';

export const UpdateModulesSchema = z.object({
  modules: z.record(z.string(), z.boolean()),
});
export type UpdateModulesInput = z.infer<typeof UpdateModulesSchema>;
