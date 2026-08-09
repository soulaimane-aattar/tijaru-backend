import { SetMetadata } from '@nestjs/common';

export const REQUIRE_MODULE_KEY = 'requireModule';

export const RequiresModule = (moduleId: string): ClassDecorator & MethodDecorator =>
  SetMetadata(REQUIRE_MODULE_KEY, moduleId);
