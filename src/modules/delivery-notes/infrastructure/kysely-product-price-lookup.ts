import { Injectable } from '@nestjs/common';

import { Db } from '../../../database';
import { ProductPriceLookup } from '../domain/delivery-notes.repository';

/**
 * Kysely-backed price lookup used to prefill a delivery-note line's
 * `unitPrice` when the caller omits it. Uses the product's `sale` price
 * (the sell/HT price already used elsewhere, e.g. POS) as the default.
 */
@Injectable()
export class KyselyProductPriceLookup extends ProductPriceLookup {
  constructor(private readonly db: Db) {
    super();
  }

  async findById(
    businessId: string,
    productId: string,
  ): Promise<{ id: string; price: number } | null> {
    const p = await this.db.q
      .selectFrom('app.products')
      .select(['id', 'sale'])
      .where('business_id', '=', businessId)
      .where('id', '=', productId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    return p ? { id: p.id, price: Number(p.sale) } : null;
  }
}
