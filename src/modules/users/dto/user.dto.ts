import { z } from 'zod';

import { ROLE_IDS } from '../../../domain/permissions';

const RoleEnum = z.enum(ROLE_IDS);

/** `null`/omitted = every module the business has; array = only these (owner-assigned allow-list). */
const ModulesField = z.array(z.string().min(1).max(40)).max(40).nullable();

export const CreateUserSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  phone: z.string().optional(),
  password: z.string().min(8),
  role: RoleEnum,
  warehouseIds: z.array(z.string().cuid()).default([]),
  modules: ModulesField.optional(),
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
    modules: ModulesField,
  })
  .partial();
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;
