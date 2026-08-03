import { Injectable } from '@nestjs/common';

import { ConflictError, NotFoundError } from '../../../common/errors';
import { CategoriesRepository } from '../domain/categories.repository';
import type { CreateCategoryInput, UpdateCategoryInput } from '../dto/category.dto';

@Injectable()
export class CategoriesService {
  constructor(private readonly categories: CategoriesRepository) {}

  list(): Promise<unknown> {
    return this.categories.findAll();
  }

  async create(input: CreateCategoryInput): Promise<unknown> {
    if (await this.categories.existsByName(input.name)) {
      throw new ConflictError('Category name already exists');
    }
    return this.categories.create(input);
  }

  async update(id: string, input: UpdateCategoryInput): Promise<unknown> {
    if (!(await this.categories.existsById(id))) throw new NotFoundError('Category', id);
    return this.categories.update(id, input);
  }

  async remove(id: string): Promise<void> {
    if (await this.categories.isInUse(id)) {
      throw new ConflictError('Category is in use by products');
    }
    const deleted = await this.categories.delete(id);
    if (deleted === 0) throw new NotFoundError('Category', id);
  }
}
