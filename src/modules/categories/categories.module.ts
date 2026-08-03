import { Module } from '@nestjs/common';


import { CategoriesService } from './application/categories.service';
import { CategoriesController } from './categories.controller';
import { CategoriesRepository } from './domain/categories.repository';
import { PrismaCategoriesRepository } from './infrastructure/prisma-categories.repository';

@Module({
  controllers: [CategoriesController],
  providers: [
    CategoriesService,
    { provide: CategoriesRepository, useClass: PrismaCategoriesRepository },
  ],
})
export class CategoriesModule {}
