import { SetMetadata } from '@nestjs/common';

export const ENFORCE_LIMIT_KEY = 'enforceLimit';
export type LimitResource = 'users' | 'products' | 'warehouses';

export const EnforceLimit = (resource: LimitResource): MethodDecorator =>
  SetMetadata(ENFORCE_LIMIT_KEY, resource);
