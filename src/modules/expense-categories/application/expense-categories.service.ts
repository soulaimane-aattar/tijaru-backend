import { Injectable } from '@nestjs/common';

import { NotFoundError, ValidationError } from '../../../common/errors';
import {
  ExpenseCategoriesRepository,
  type ExpenseCategoryView,
} from '../domain/expense-categories.repository';
import type {
  CreateExpenseCategoryInput,
  ListExpenseCategoriesQuery,
  UpdateExpenseCategoryInput,
} from '../dto/expense-category.dto';

@Injectable()
export class ExpenseCategoriesService {
  constructor(private readonly repo: ExpenseCategoriesRepository) {}

  list(query: ListExpenseCategoriesQuery): Promise<ExpenseCategoryView[]> {
    return this.repo.findAll(query.includeArchived ?? false);
  }

  async create(input: CreateExpenseCategoryInput): Promise<ExpenseCategoryView> {
    const existing = await this.repo.findByKey(input.key);
    if (existing) throw new ValidationError(`Category key already exists: ${input.key}`);
    return this.repo.create(input);
  }

  async update(id: string, input: UpdateExpenseCategoryInput): Promise<ExpenseCategoryView> {
    const found = await this.repo.findById(id);
    if (!found) throw new NotFoundError('ExpenseCategory', id);
    const count = await this.repo.update(id, input);
    if (count === 0) throw new NotFoundError('ExpenseCategory', id);
    const updated = await this.repo.findById(id);
    if (!updated) throw new NotFoundError('ExpenseCategory', id);
    return updated;
  }

  /**
   * Soft-archive when the category is still referenced by historical expenses,
   * hard-delete when nothing points at it. Either way it disappears from the
   * default picker; the archive branch keeps old reports resolvable.
   */
  async remove(id: string): Promise<{ archived: boolean; deleted: boolean }> {
    const found = await this.repo.findById(id);
    if (!found) throw new NotFoundError('ExpenseCategory', id);
    const uses = await this.repo.countUses(found.key);
    if (uses > 0) {
      await this.repo.update(id, { archived: true });
      return { archived: true, deleted: false };
    }
    await this.repo.delete(id);
    return { archived: false, deleted: true };
  }
}
