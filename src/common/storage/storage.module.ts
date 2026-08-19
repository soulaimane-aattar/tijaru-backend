import { Global, Module } from '@nestjs/common';

import { LocalStorageService } from './local-storage.service';

/**
 * Global module — any feature module can inject `LocalStorageService` without
 * having to import this one. Storage is a cross-cutting concern used by
 * receipts (expenses), product images, and any future upload flow.
 */
@Global()
@Module({
  providers: [LocalStorageService],
  exports: [LocalStorageService],
})
export class StorageModule {}
