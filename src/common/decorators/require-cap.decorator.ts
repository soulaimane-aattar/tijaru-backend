import { SetMetadata } from '@nestjs/common';

import type { CapabilityId } from '../../domain/permissions';

export const REQUIRE_CAP_KEY = 'requireCap';

export const RequireCap = (...caps: CapabilityId[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_CAP_KEY, caps);
