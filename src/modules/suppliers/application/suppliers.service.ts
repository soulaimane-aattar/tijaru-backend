import { Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../common/errors';
import { SuppliersRepository } from '../domain/suppliers.repository';
import type { CreateSupplierInput, UpdateSupplierInput } from '../dto/supplier.dto';

@Injectable()
export class SuppliersService {
  constructor(private readonly suppliers: SuppliersRepository) {}

  list(): Promise<unknown> {
    return this.suppliers.findAll();
  }

  async get(id: string): Promise<unknown> {
    const s = await this.suppliers.findDetail(id);
    if (!s) throw new NotFoundError('Supplier', id);
    return s;
  }

  create(input: CreateSupplierInput): Promise<unknown> {
    return this.suppliers.create(input);
  }

  async update(id: string, input: UpdateSupplierInput): Promise<unknown> {
    const updated = await this.suppliers.update(id, input);
    if (updated === 0) throw new NotFoundError('Supplier', id);
    return this.suppliers.findById(id);
  }

  async remove(id: string): Promise<void> {
    const deleted = await this.suppliers.delete(id);
    if (deleted === 0) throw new NotFoundError('Supplier', id);
  }
}
