import { Module } from '@nestjs/common';

import { PrismaService } from '../../common/prisma.service';

import { UsersService } from './application/users.service';
import { UsersController } from './users.controller';

@Module({
  controllers: [UsersController],
  providers: [UsersService, PrismaService],
  exports: [UsersService],
})
export class UsersModule {}
