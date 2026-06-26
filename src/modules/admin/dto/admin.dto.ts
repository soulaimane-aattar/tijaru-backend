import { z } from 'zod';

import { CAPABILITY_IDS, ROLE_IDS } from '../../../domain/permissions';

const CapEnum = z.enum(CAPABILITY_IDS);
const RoleEnum = z.enum(ROLE_IDS);

export const PatchRoleSchema = z.object({
  capabilities: z.record(CapEnum, z.boolean()),
});
export type PatchRoleInput = z.infer<typeof PatchRoleSchema>;

export const PatchOverridesSchema = z.object({
  overrides: z.record(
    CapEnum,
    z.union([z.literal('role'), z.boolean()]),
  ),
});
export type PatchOverridesInput = z.infer<typeof PatchOverridesSchema>;

export { RoleEnum, CapEnum };

export const PatchSecurityPolicySchema = z
  .object({
    passwordMinLen: z.number().int().min(4).max(64),
    requireUpper: z.boolean(),
    requireDigit: z.boolean(),
    requireSymbol: z.boolean(),
    passwordExpiryDays: z.number().int().min(0).max(365),
    passwordHistoryCount: z.number().int().min(0).max(20),
    twoFARequiredFor: z.array(RoleEnum),
    lockAfterFailures: z.number().int().min(0).max(20),
    sessionTimeoutMin: z.number().int().min(5).max(1440),
    ipAllowlist: z.array(z.string().min(1).max(64)),
    auditRetentionDays: z.number().int().min(30).max(3650),
  })
  .partial();
export type PatchSecurityPolicyInput = z.infer<typeof PatchSecurityPolicySchema>;
