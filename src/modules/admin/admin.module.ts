import { Module } from '@nestjs/common';

import { AdminController } from './admin.controller';
import { AdminPolicyService } from './application/admin-policy.service';
import { AdminRolesService } from './application/admin-roles.service';
import { AdminSessionsService } from './application/admin-sessions.service';
import { BusinessSettingsService } from './application/business-settings.service';
import { AdminPolicyRepository } from './domain/admin-policy.repository';
import { AdminRolesRepository } from './domain/admin-roles.repository';
import { AdminSessionsRepository } from './domain/admin-sessions.repository';
import { KyselyAdminPolicyRepository } from './infrastructure/kysely-admin-policy.repository';
import { KyselyAdminRolesRepository } from './infrastructure/kysely-admin-roles.repository';
import { KyselyAdminSessionsRepository } from './infrastructure/kysely-admin-sessions.repository';

@Module({
  controllers: [AdminController],
  providers: [
    AdminRolesService,
    AdminSessionsService,
    AdminPolicyService,
    BusinessSettingsService,
    { provide: AdminPolicyRepository, useClass: KyselyAdminPolicyRepository },
    { provide: AdminRolesRepository, useClass: KyselyAdminRolesRepository },
    { provide: AdminSessionsRepository, useClass: KyselyAdminSessionsRepository },
  ],
})
export class AdminModule {}
