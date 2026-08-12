import { Module } from '@nestjs/common';

import { AdminController } from './admin.controller';
import { AdminPolicyService } from './application/admin-policy.service';
import { AdminRolesService } from './application/admin-roles.service';
import { AdminSessionsService } from './application/admin-sessions.service';
import { BusinessSettingsService } from './application/business-settings.service';
import { AdminPolicyRepository } from './domain/admin-policy.repository';
import { AdminRolesRepository } from './domain/admin-roles.repository';
import { AdminSessionsRepository } from './domain/admin-sessions.repository';
import { PrismaAdminPolicyRepository } from './infrastructure/prisma-admin-policy.repository';
import { PrismaAdminRolesRepository } from './infrastructure/prisma-admin-roles.repository';
import { PrismaAdminSessionsRepository } from './infrastructure/prisma-admin-sessions.repository';

@Module({
  controllers: [AdminController],
  providers: [
    AdminRolesService,
    AdminSessionsService,
    AdminPolicyService,
    BusinessSettingsService,
    { provide: AdminPolicyRepository, useClass: PrismaAdminPolicyRepository },
    { provide: AdminRolesRepository, useClass: PrismaAdminRolesRepository },
    { provide: AdminSessionsRepository, useClass: PrismaAdminSessionsRepository },
  ],
})
export class AdminModule {}
