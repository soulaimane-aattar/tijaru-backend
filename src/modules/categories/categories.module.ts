import { Module } from '@nestjs/common';


import { CategoriesService } from './application/categories.service';
import { CategoriesController } from './categories.controller';
import { CategoriesRepository } from './domain/categories.repository';
import { KyselyCategoriesRepository } from './infrastructure/kysely-categories.repository';

@Module({
  controllers: [CategoriesController],
  providers: [
    CategoriesService,
    { provide: CategoriesRepository, useClass: KyselyCategoriesRepository },
  ],
})
export class CategoriesModule {}
