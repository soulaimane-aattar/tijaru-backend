import { z } from 'zod';

import { ROLE_IDS } from '../../../domain/permissions';

const RoleEnum = z.enum(ROLE_IDS);

export const CreateUserSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  phone: z.string().optional(),
  password: z.string().min(8),
  role: RoleEnum,
  warehouseIds: z.array(z.string().cuid()).default([]),
});
export type CreateUserInput = z.infer<typeof CreateUserSchema>;

export const UpdateUserSchema = z
  .object({
    name: z.string().min(1).max(120),
    email: z.string().email(),
    phone: z.string().optional(),
    password: z.string().min(8),
    role: RoleEnum,
    active: z.boolean(),
    warehouseIds: z.array(z.string().cuid()),
  })
  .partial();
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;
