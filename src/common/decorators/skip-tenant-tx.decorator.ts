import { SetMetadata } from '@nestjs/common';

export const SKIP_TENANT_TX_KEY = 'skipTenantTx';

/** Route does slow non-DB I/O (OCR…): don't pin a pooled connection for the whole request. DB calls must use `Db.scoped`. */
export const SkipTenantTx = (): MethodDecorator => SetMetadata(SKIP_TENANT_TX_KEY, true);
