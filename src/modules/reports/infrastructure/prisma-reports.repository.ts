import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma.service';
import {
  ReportsRepository,
  type OutboundMovementRow,
  type ProductStockRow,
  type StockValueRow,
} from '../domain/reports.repository';

const dec = (n: Prisma.Decimal | number): number =>
  typeof n === 'number' ? n : Number(n.toString());

@Injectable()
export class PrismaReportsRepository extends ReportsRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  findActiveProductsWithStock(): Promise<ProductStockRow[]> {
    return this.prisma.product.findMany({
      where: { deletedAt: null },
      include: {
        stockLevels: true,
        category: { select: { id: true, name: true, tone: true } },
      },
    });
  }

  findExpiring(horizon: Date): Promise<unknown[]> {
    return this.prisma.product.findMany({
      where: {
        deletedAt: null,
        trackExpiry: true,
        expiry: { lte: horizon, gte: new Date() },
      },
      include: { stockLevels: true, category: { select: { id: true, name: true, tone: true } } },
      orderBy: { expiry: 'asc' },
    });
  }

  async findStockValueRows(): Promise<StockValueRow[]> {
    const stockLevels = await this.prisma.stockLevel.findMany({
      where: { product: { deletedAt: null } },
      include: {
        product: { select: { purchase: true } },
        warehouse: { select: { id: true, name: true, city: true } },
      },
    });
    return stockLevels.map((s) => ({
      warehouseId: s.warehouseId,
      warehouseName: s.warehouse.name,
      warehouseCity: s.warehouse.city,
      qty: s.qty,
      purchase: dec(s.product.purchase),
    }));
  }

  findOutboundSince(since: Date): Promise<OutboundMovementRow[]> {
    return this.prisma.movement.findMany({
      where: { type: 'out', date: { gte: since } },
      include: { product: { select: { id: true, name: true, sku: true, tone: true } } },
    });
  }
}
