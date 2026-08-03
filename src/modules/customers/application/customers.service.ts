import { Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../common/errors';
import { CustomersRepository } from '../domain/customers.repository';
import type {
  CreateCustomerInput,
  ListCustomersQuery,
  UpdateCustomerInput,
} from '../dto/customer.dto';

@Injectable()
export class CustomersService {
  constructor(private readonly customers: CustomersRepository) {}

  list(query: ListCustomersQuery): Promise<unknown> {
    return this.customers.findAll(query.search);
  }

  async get(id: string): Promise<unknown> {
    const c = await this.customers.findById(id);
    if (!c) throw new NotFoundError('Customer', id);
    return c;
  }

  create(input: CreateCustomerInput): Promise<unknown> {
    return this.customers.create(input);
  }

  async update(id: string, input: UpdateCustomerInput): Promise<unknown> {
    const updated = await this.customers.update(id, input);
    if (updated === 0) throw new NotFoundError('Customer', id);
    return this.customers.findById(id);
  }

  async remove(id: string): Promise<void> {
    const deleted = await this.customers.delete(id);
    if (deleted === 0) throw new NotFoundError('Customer', id);
  }
}
