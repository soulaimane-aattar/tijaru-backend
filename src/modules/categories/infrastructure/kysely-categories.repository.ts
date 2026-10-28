
import { Injectable } from '@nestjs/common';

import { Db } from '../../../database';
import { newId } from '../../../database/ids';
import { camelRow, defined } from '../../row-case';
import {
  CategoriesRepository,
  type CreateCategoryData,
  type UpdateCategoryData,
} from '../domain/categories.repository';

@Injectable()
export class KyselyCategoriesRepository extends CategoriesRepository {
  constructor(private readonly db: Db) {
    super();
  }

  async findAll(): Promise<unknown[]> {
    const rows = await this.db.q
      .selectFrom('app.categories as c')
      .selectAll('c')
      .select((qb) =>
        qb
          .selectFrom('app.products as p')
          .select(qb.fn.countAll<string>().as('n'))
          .whereRef('p.categoryId', '=', 'c.id')
          .as('products'),
      )
      .where('c.business_id', '=', this.db.businessId)
      .orderBy('c.name')
      .execute();
    return rows.map(({ products, ...c }) => ({ ...camelRow(c), _count: { products: Number(products) } }));
  }

  async existsByName(name: string): Promise<boolean> {
    const r = await this.db.q
      .selectFrom('app.categories')
      .select('id')
      .where('business_id', '=', this.db.businessId)
      .where('name', '=', name)
      .executeTakeFirst();
    return r !== undefined;
  }

  async existsById(id: string): Promise<boolean> {
    const r = await this.db.q
      .selectFrom('app.categories')
      .select('id')
      .where('business_id', '=', this.db.businessId)
      .where('id', '=', id)
      .executeTakeFirst();
    return r !== undefined;
  }

  async isInUse(id: string): Promise<boolean> {
    const r = await this.db.q
      .selectFrom('app.products')
      .select('id')
      .where('business_id', '=', this.db.businessId)
      .where('categoryId', '=', id)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    return r !== undefined;
  }

  async create(data: CreateCategoryData): Promise<unknown> {
    const row = await this.db.q
      .insertInto('app.categories')
      .values({ id: newId(), business_id: this.db.businessId, ...defined(data) } as never)
      .returningAll()
      .executeTakeFirstOrThrow();
    return camelRow(row);
  }

  async update(id: string, data: UpdateCategoryData): Promise<unknown> {
    const row = await this.db.q
      .updateTable('app.categories')
      .set(defined(data))
      .where('business_id', '=', this.db.businessId)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return camelRow(row);
  }

  async delete(id: string): Promise<number> {
    const r = await this.db.q
      .deleteFrom('app.categories')
      .where('business_id', '=', this.db.businessId)
      .where('id', '=', id)
      .executeTakeFirst();
    return Number(r.numDeletedRows);
  }
}
