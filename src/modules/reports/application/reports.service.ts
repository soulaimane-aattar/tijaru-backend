import { Injectable } from '@nestjs/common';

import {
  ReportsRepository,
  type OutboundMovementRow,
  type ProductStockRow,
} from '../domain/reports.repository';
import type { DaysQuery } from '../dto/report.dto';

const DAY_MS = 86_400_000;

const withTotalStock = (p: ProductStockRow): ProductStockRow & { totalStock: number } => ({
  ...p,
  totalStock: p.stockLevels.reduce((s, l) => s + l.qty, 0),
});

@Injectable()
export class ReportsService {
  constructor(private readonly reports: ReportsRepository) {}

  async lowStock(): Promise<unknown> {
    const products = await this.reports.findActiveProductsWithStock();
    return products
      .map(withTotalStock)
      .filter((p) => p.totalStock > 0 && p.totalStock <= p.minStock)
      .sort((a, b) => a.totalStock - b.totalStock);
  }

  async outOfStock(): Promise<unknown> {
    const products = await this.reports.findActiveProductsWithStock();
    return products.map(withTotalStock).filter((p) => p.totalStock === 0);
  }

  expiring(q: DaysQuery): Promise<unknown> {
    const horizon = new Date(Date.now() + q.days * DAY_MS);
    return this.reports.findExpiring(horizon);
  }

  /** Stock value per warehouse (HT): Σ(qty × purchase). */
  async value(): Promise<unknown> {
    const rows = await this.reports.findStockValueRows();
    const byWarehouse = new Map<
      string,
      { warehouseId: string; name: string; city: string; value: number; units: number }
    >();
    let grandValue = 0;
    let grandUnits = 0;
    for (const row of rows) {
      const value = row.purchase * row.qty;
      grandValue += value;
      grandUnits += row.qty;
      const entry = byWarehouse.get(row.warehouseId) ?? {
        warehouseId: row.warehouseId,
        name: row.warehouseName,
        city: row.warehouseCity,
        value: 0,
        units: 0,
      };
      entry.value += value;
      entry.units += row.qty;
      byWarehouse.set(row.warehouseId, entry);
    }
    return {
      total: { value: +grandValue.toFixed(2), units: grandUnits },
      perWarehouse: [...byWarehouse.values()].map((e) => ({
        ...e,
        value: +e.value.toFixed(2),
      })),
    };
  }

  /** Top outbound products in the last N days. */
  async top(q: DaysQuery): Promise<unknown> {
    const since = new Date(Date.now() - q.days * DAY_MS);
    const movements = await this.reports.findOutboundSince(since);
    const byProduct = new Map<string, { product: OutboundMovementRow['product']; qty: number }>();
    for (const m of movements) {
      const e = byProduct.get(m.productId);
      if (e) e.qty += m.qty;
      else byProduct.set(m.productId, { product: m.product, qty: m.qty });
    }
    return [...byProduct.values()]
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 10);
  }
}
