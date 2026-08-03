import { z } from 'zod';

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'tone must be #RRGGBB');

export const CreateCategorySchema = z.object({
  name: z.string().min(1).max(80),
  icon: z.string().min(1).max(40),
  tone: HexColor,
});
export type CreateCategoryInput = z.infer<typeof CreateCategorySchema>;

export const UpdateCategorySchema = CreateCategorySchema.partial();
export type UpdateCategoryInput = z.infer<typeof UpdateCategorySchema>;
