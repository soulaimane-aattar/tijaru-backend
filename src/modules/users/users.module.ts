import { Module } from '@nestjs/common';


import { UsersService } from './application/users.service';
import { UsersRepository } from './domain/users.repository';
import { PrismaUsersRepository } from './infrastructure/prisma-users.repository';
import { UsersController } from './users.controller';

@Module({
  controllers: [UsersController],
  providers: [
    UsersService,
    { provide: UsersRepository, useClass: PrismaUsersRepository },
  ],
  exports: [UsersService],
})
export class UsersModule {}
