import { Module } from '@nestjs/common';


import { AuthService } from './application/auth.service';
import { AuthController } from './auth.controller';
import { AuthRepository } from './domain/auth.repository';
import { PrismaAuthRepository } from './infrastructure/prisma-auth.repository';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    { provide: AuthRepository, useClass: PrismaAuthRepository },
  ],
  exports: [AuthService],
})
export class AuthModule {}
