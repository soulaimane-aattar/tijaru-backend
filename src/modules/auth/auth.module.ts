import { Module } from '@nestjs/common';


import { AuthService } from './application/auth.service';
import { PlatformAdminMfaService } from './application/platform-admin-mfa.service';
import { AuthController } from './auth.controller';
import { AuthRepository } from './domain/auth.repository';
import { KyselyAuthRepository } from './infrastructure/kysely-auth.repository';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    PlatformAdminMfaService,
    { provide: AuthRepository, useClass: KyselyAuthRepository },
  ],
  exports: [AuthService],
})
export class AuthModule {}
