import { z } from 'zod';

/** Every module id a business can have (ids match `@RequiresModule` + client nav). */
export const MODULE_IDS = [
  'stock',
  'multi-stock',
  'pos',
  'customers',
  'suppliers',
  'expenses',
  'purchase-orders',
  'inventory',
  'reports',
  'invoices',
  'delivery-notes',
  'estimates',
  'hr',
  'marketplace',
] as const;

export const UpdateModulesSchema = z.object({
  modules: z
    .record(z.string(), z.boolean())
    .refine((m) => Object.keys(m).every((k) => (MODULE_IDS as readonly string[]).includes(k)), {
      message: 'unknown_module',
    }),
});
export type UpdateModulesInput = z.infer<typeof UpdateModulesSchema>;
