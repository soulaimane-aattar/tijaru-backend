import { Injectable } from '@nestjs/common';

import { Db } from '../../../database';
import { camelRow } from '../../row-case';
import {
  ReportsRepository,
  type OutboundMovementRow,
  type ProductStockRow,
  type StockValueRow,
} from '../domain/reports.repository';

@Injectable()
export class KyselyReportsRepository extends ReportsRepository {
  constructor(private readonly db: Db) {
    super();
  }

  /** Non-deleted products (optionally narrowed) + their stock levels + `{ id, name, tone }` category. */
  private async productsWithStock(
    narrow: (
      q: ReturnType<KyselyReportsRepository['baseProducts']>,
    ) => ReturnType<KyselyReportsRepository['baseProducts']>,
  ): Promise<ProductStockRow[]> {
    const rows = await narrow(this.baseProducts()).execute();
    if (rows.length === 0) return [];
    const levels = await this.db.q
      .selectFrom('app.stock_levels')
      .selectAll()
      .where('businessId', '=', this.db.businessId)
      .where('productId', 'in', rows.map((r) => r.id))
      .execute();
    return rows.map(({ c_id, c_name, c_tone, ...p }) => ({
      ...camelRow(p),
      minStock: p.minStock,
      stockLevels: levels.filter((l) => l.productId === p.id),
      category: { id: c_id, name: c_name, tone: c_tone },
    }));
  }

  private baseProducts() {
    return this.db.q
      .selectFrom('app.products as p')
      .innerJoin('app.categories as c', 'c.id', 'p.categoryId')
      .selectAll('p')
      .select(['c.id as c_id', 'c.name as c_name', 'c.tone as c_tone'])
      .where('p.business_id', '=', this.db.businessId)
      .where('p.deletedAt', 'is', null);
  }

  findActiveProductsWithStock(): Promise<ProductStockRow[]> {
    return this.productsWithStock((q) => q);
  }

  findExpiring(horizon: Date): Promise<unknown[]> {
    return this.productsWithStock((q) =>
      q.where('p.trackExpiry', '=', true).where('p.expiry', '<=', horizon).where('p.expiry', '>=', new Date()).orderBy('p.expiry'),
    );
  }

  async findStockValueRows(): Promise<StockValueRow[]> {
    const rows = await this.db.q
      .selectFrom('app.stock_levels as s')
      .innerJoin('app.products as p', 'p.id', 's.productId')
      .innerJoin('app.warehouses as w', 'w.id', 's.warehouseId')
      .select(['s.warehouseId', 'w.name as warehouseName', 'w.city as warehouseCity', 's.qty', 'p.purchase'])
      .where('s.businessId', '=', this.db.businessId)
      .where('p.deletedAt', 'is', null)
      .execute();
    return rows.map((r) => ({ ...r, purchase: Number(r.purchase) }));
  }

  async findOutboundSince(since: Date): Promise<OutboundMovementRow[]> {
    const rows = await this.db.q
      .selectFrom('app.movements as m')
      .innerJoin('app.products as p', 'p.id', 'm.productId')
      .selectAll('m')
      .select(['p.name as p_name', 'p.sku as p_sku', 'p.tone as p_tone'])
      .where('m.business_id', '=', this.db.businessId)
      .where('m.type', '=', 'out')
      .where('m.date', '>=', since)
      .execute();
    return rows.map(({ p_name, p_sku, p_tone, ...m }) => ({
      ...camelRow(m),
      productId: m.productId,
      qty: m.qty,
      product: { id: m.productId, name: p_name, sku: p_sku, tone: p_tone },
    }));
  }
}
