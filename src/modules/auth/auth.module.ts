import { Module } from '@nestjs/common';

import { PrismaService } from '../../common/prisma.service';

import { AuthService } from './application/auth.service';
import { AuthController } from './auth.controller';

@Module({
  controllers: [AuthController],
  providers: [AuthService, PrismaService],
  exports: [AuthService],
})
export class AuthModule {}
