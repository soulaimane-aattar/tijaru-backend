import { Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../common/errors';
import { CustomerCategoriesRepository, CustomersRepository } from '../domain/customers.repository';
import type {
  CreateCustomerCategoryInput,
  CreateCustomerInput,
  ListCustomersQuery,
  UpdateCustomerCategoryInput,
  UpdateCustomerInput,
} from '../dto/customer.dto';

@Injectable()
export class CustomersService {
  constructor(
    private readonly customers: CustomersRepository,
    private readonly categories: CustomerCategoriesRepository,
  ) {}

  listCategories(): Promise<unknown[]> {
    return this.categories.findAll();
  }

  createCategory(input: CreateCustomerCategoryInput): Promise<unknown> {
    return this.categories.create(input);
  }

  async updateCategory(id: string, input: UpdateCustomerCategoryInput): Promise<unknown> {
    const row = await this.categories.update(id, input);
    if (!row) throw new NotFoundError('CustomerCategory', id);
    return row;
  }

  async removeCategory(id: string): Promise<void> {
    if ((await this.categories.delete(id)) === 0) throw new NotFoundError('CustomerCategory', id);
  }

  list(query: ListCustomersQuery): Promise<unknown> {
    return this.customers.findAll(query.search);
  }

  async get(id: string): Promise<unknown> {
    const c = await this.customers.findById(id);
    if (!c) throw new NotFoundError('Customer', id);
    return c;
  }

  async create(input: CreateCustomerInput): Promise<unknown> {
    await this.assertCategory(input.categoryId);
    return this.customers.create(input);
  }

  async update(id: string, input: UpdateCustomerInput): Promise<unknown> {
    await this.assertCategory(input.categoryId);
    const row = await this.customers.update(id, input);
    if (!row) throw new NotFoundError('Customer', id);
    return row;
  }

  /** The FK ignores RLS, so verify the category belongs to this tenant (lookup is RLS-scoped). */
  private async assertCategory(categoryId: string | null | undefined): Promise<void> {
    if (categoryId && !(await this.categories.findById(categoryId))) {
      throw new NotFoundError('CustomerCategory', categoryId);
    }
  }

  async remove(id: string): Promise<void> {
    const deleted = await this.customers.delete(id);
    if (deleted === 0) throw new NotFoundError('Customer', id);
  }
}
