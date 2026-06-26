import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { RequireCap } from '../../common/decorators/require-cap.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../common/prisma.service';

const DaysQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});
type DaysQuery = z.infer<typeof DaysQuerySchema>;

const dec = (n: Prisma.Decimal | number): number =>
  typeof n === 'number' ? n : Number(n.toString());

@Injectable()
class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async lowStock(): Promise<unknown> {
    const products = await this.prisma.product.findMany({
      where: { deletedAt: null },
      include: {
        stockLevels: true,
        category: { select: { id: true, name: true, tone: true } },
      },
    });
    return products
      .map((p) => ({
        ...p,
        totalStock: p.stockLevels.reduce((s, l) => s + l.qty, 0),
      }))
      .filter((p) => p.totalStock > 0 && p.totalStock <= p.minStock)
      .sort((a, b) => a.totalStock - b.totalStock);
  }

  async outOfStock(): Promise<unknown> {
    const products = await this.prisma.product.findMany({
      where: { deletedAt: null },
      include: { stockLevels: true, category: { select: { id: true, name: true, tone: true } } },
    });
    return products
      .map((p) => ({ ...p, totalStock: p.stockLevels.reduce((s, l) => s + l.qty, 0) }))
      .filter((p) => p.totalStock === 0);
  }

  expiring(q: DaysQuery): Promise<unknown> {
    const horizon = new Date(Date.now() + q.days * 86_400_000);
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

  /** Stock value per warehouse (HT): Σ(qty × purchase). */
  async value(): Promise<unknown> {
    const stockLevels = await this.prisma.stockLevel.findMany({
      include: {
        product: { select: { id: true, name: true, purchase: true, deletedAt: true } },
        warehouse: { select: { id: true, name: true, city: true } },
      },
    });
    const byWarehouse = new Map<
      string,
      { warehouseId: string; name: string; city: string; value: number; units: number }
    >();
    let grandValue = 0;
    let grandUnits = 0;
    for (const s of stockLevels) {
      if (s.product.deletedAt) continue;
      const value = dec(s.product.purchase) * s.qty;
      grandValue += value;
      grandUnits += s.qty;
      const entry = byWarehouse.get(s.warehouseId) ?? {
        warehouseId: s.warehouseId,
        name: s.warehouse.name,
        city: s.warehouse.city,
        value: 0,
        units: 0,
      };
      entry.value += value;
      entry.units += s.qty;
      byWarehouse.set(s.warehouseId, entry);
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
    const since = new Date(Date.now() - q.days * 86_400_000);
    const movements = await this.prisma.movement.findMany({
      where: { type: 'out', date: { gte: since } },
      include: { product: { select: { id: true, name: true, sku: true, tone: true } } },
    });
    const byProduct = new Map<string, { product: typeof movements[number]['product']; qty: number }>();
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

@ApiTags('reports')
@ApiBearerAuth()
@Controller({ path: 'reports', version: '1' })
class ReportsController {
  constructor(private readonly svc: ReportsService) {}

  @Get('low-stock')
  @RequireCap('reports.view')
  lowStock(): Promise<unknown> {
    return this.svc.lowStock();
  }

  @Get('out-of-stock')
  @RequireCap('reports.view')
  outOfStock(): Promise<unknown> {
    return this.svc.outOfStock();
  }

  @Get('expiring')
  @RequireCap('reports.view')
  expiring(@Query(new ZodValidationPipe(DaysQuerySchema)) query: DaysQuery): Promise<unknown> {
    return this.svc.expiring(query);
  }

  @Get('value')
  @RequireCap('reports.view')
  value(): Promise<unknown> {
    return this.svc.value();
  }

  @Get('top')
  @RequireCap('reports.view')
  top(@Query(new ZodValidationPipe(DaysQuerySchema)) query: DaysQuery): Promise<unknown> {
    return this.svc.top(query);
  }
}

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, PrismaService],
})
export class ReportsModule {}
