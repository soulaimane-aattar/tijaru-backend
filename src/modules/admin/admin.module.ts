import { Module } from '@nestjs/common';

import { AdminController } from './admin.controller';
import { AdminPolicyService } from './application/admin-policy.service';
import { AdminRolesService } from './application/admin-roles.service';
import { AdminSessionsService } from './application/admin-sessions.service';

@Module({
  controllers: [AdminController],
  providers: [AdminRolesService, AdminSessionsService, AdminPolicyService],
})
export class AdminModule {}
