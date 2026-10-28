import { Module } from '@nestjs/common';


import { UsersService } from './application/users.service';
import { UsersRepository } from './domain/users.repository';
import { KyselyUsersRepository } from './infrastructure/kysely-users.repository';
import { UsersController } from './users.controller';

@Module({
  controllers: [UsersController],
  providers: [
    UsersService,
    { provide: UsersRepository, useClass: KyselyUsersRepository },
  ],
  exports: [UsersService],
})
export class UsersModule {}
