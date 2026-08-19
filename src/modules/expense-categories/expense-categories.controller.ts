import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { RequireCap } from '../../common/decorators/require-cap.decorator';
import { RequiresModule } from '../../common/decorators/require-module.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

import { ExpenseCategoriesService } from './application/expense-categories.service';
import type { ExpenseCategoryView } from './domain/expense-categories.repository';
import {
  type CreateExpenseCategoryInput,
  CreateExpenseCategorySchema,
  type ListExpenseCategoriesQuery,
  ListExpenseCategoriesSchema,
  type UpdateExpenseCategoryInput,
  UpdateExpenseCategorySchema,
} from './dto/expense-category.dto';

@ApiTags('expense-categories')
@ApiBearerAuth()
@RequiresModule('expenses')
@Controller({ path: 'expense-categories', version: '1' })
export class ExpenseCategoriesController {
  constructor(private readonly svc: ExpenseCategoriesService) {}

  @Get()
  @RequireCap('expenses.view')
  list(
    @Query(new ZodValidationPipe(ListExpenseCategoriesSchema)) query: ListExpenseCategoriesQuery,
  ): Promise<ExpenseCategoryView[]> {
    return this.svc.list(query);
  }

  @Post()
  @RequireCap('expenses.edit')
  create(
    @Body(new ZodValidationPipe(CreateExpenseCategorySchema)) body: CreateExpenseCategoryInput,
  ): Promise<ExpenseCategoryView> {
    return this.svc.create(body);
  }

  @Patch(':id')
  @RequireCap('expenses.edit')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateExpenseCategorySchema)) body: UpdateExpenseCategoryInput,
  ): Promise<ExpenseCategoryView> {
    return this.svc.update(id, body);
  }

  @Delete(':id')
  @RequireCap('expenses.edit')
  remove(@Param('id') id: string): Promise<{ archived: boolean; deleted: boolean }> {
    return this.svc.remove(id);
  }
}
