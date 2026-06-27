import type { CapabilityId, RoleId } from '../../domain/permissions';

export type AuthUser = {
  id: string;
  businessId: string;
  role: RoleId;
  tokenVersion: number;
  /** Capabilities granted by the user's role (effective, including role customizations). */
  roleCaps: CapabilityId[];
  /** Per-user grants/denies that override role caps. */
  overrides: Partial<Record<CapabilityId, boolean>>;
  device?: string | undefined;
};
