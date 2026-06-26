import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Param,
  Post,
  UsePipes,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import type { AuthUser } from '../../common/auth/auth-user.type';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireCap } from '../../common/decorators/require-cap.decorator';
import { DomainError, NotFoundError } from '../../common/errors';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../common/prisma.service';

const StartCountSchema = z.object({
  warehouseId: z.string().cuid(),
  notes: z.string().max(2000).optional(),
});
type StartCountInput = z.infer<typeof StartCountSchema>;

const ApplyCountSchema = z.object({
  lines: z
    .array(
      z.object({
        productId: z.string().cuid(),
        counted: z.number().int().min(0),
      }),
    )
    .min(1),
});
type ApplyCountInput = z.infer<typeof ApplyCountSchema>;

@Injectable()
class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  list(): Promise<unknown> {
    return this.prisma.inventoryCount.findMany({
      include: {
        warehouse: { select: { id: true, name: true, city: true } },
        _count: { select: { lines: true } },
      },
      orderBy: { date: 'desc' },
    });
  }

  async get(id: string): Promise<unknown> {
    const count = await this.prisma.inventoryCount.findUnique({
      where: { id },
      include: {
        warehouse: true,
        lines: { include: { product: { select: { id: true, name: true, sku: true } } } },
      },
    });
    if (!count) throw new NotFoundError('InventoryCount', id);
    return count;
  }

  /** Start a count: snapshot expected qty per product at the chosen warehouse. */
  async start(input: StartCountInput): Promise<unknown> {
    const wh = await this.prisma.warehouse.findFirst({
      where: { id: input.warehouseId, deletedAt: null },
    });
    if (!wh) throw new NotFoundError('Warehouse', input.warehouseId);

    const stockLevels = await this.prisma.stockLevel.findMany({
      where: { warehouseId: input.warehouseId },
      include: { product: { select: { id: true, deletedAt: true } } },
    });
    const active = stockLevels.filter((s) => s.product.deletedAt === null);

    return this.prisma.inventoryCount.create({
      data: {
        warehouseId: input.warehouseId,
        ...(input.notes ? { notes: input.notes } : {}),
        lines: {
          create: active.map((s) => ({
            productId: s.productId,
            expected: s.qty,
            counted: s.qty, // default = expected; user adjusts before apply
          })),
        },
      },
      include: {
        lines: { include: { product: { select: { id: true, name: true, sku: true } } } },
      },
    });
  }

  /**
   * Apply a count: for each line where counted !== expected, emit a Movement
   * with reason 'ajustement', and overwrite StockLevel to the counted value.
   * Atomic transaction. Sets appliedAt.
   */
  async apply(id: string, input: ApplyCountInput, actor: AuthUser): Promise<unknown> {
    const count = await this.prisma.inventoryCount.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!count) throw new NotFoundError('InventoryCount', id);
    if (count.appliedAt) {
      throw new DomainError('already_applied', 'Inventory count already applied', 422);
    }

    const inputByProduct = new Map(input.lines.map((l) => [l.productId, l.counted]));

    return this.prisma.$transaction(async (tx) => {
      for (const line of count.lines) {
        const counted = inputByProduct.get(line.productId) ?? line.counted;
        const diff = counted - line.expected;
        if (diff !== 0) {
          await tx.movement.create({
            data: {
              type: diff > 0 ? 'in' : 'out',
              productId: line.productId,
              qty: Math.abs(diff),
              warehouseId: count.warehouseId,
              userId: actor.id,
              reason: 'ajustement',
              ref: `INV-${count.id.slice(-6).toUpperCase()}`,
            },
          });
          await tx.stockLevel.upsert({
            where: {
              productId_warehouseId: {
                productId: line.productId,
                warehouseId: count.warehouseId,
              },
            },
            create: { productId: line.productId, warehouseId: count.warehouseId, qty: counted },
            update: { qty: counted },
          });
        }
        if (counted !== line.counted) {
          await tx.inventoryCountLine.update({
            where: { id: line.id },
            data: { counted },
          });
        }
      }

      await tx.inventoryCount.update({
        where: { id },
        data: { appliedAt: new Date() },
      });
      await tx.activity.create({
        data: {
          userId: actor.id,
          action: 'inventory.applied',
          desc: `Inventaire appliqué — ${count.lines.length} lignes`,
          ...(actor.device ? { device: actor.device } : {}),
        },
      });

      return tx.inventoryCount.findUniqueOrThrow({
        where: { id },
        include: {
          lines: { include: { product: { select: { id: true, name: true, sku: true } } } },
        },
      });
    });
  }
}

@ApiTags('inventory')
@ApiBearerAuth()
@Controller({ path: 'inventory', version: '1' })
class InventoryController {
  constructor(private readonly svc: InventoryService) {}

  @Get()
  @RequireCap('inventory.count')
  list(): Promise<unknown> {
    return this.svc.list();
  }

  @Get(':id')
  @RequireCap('inventory.count')
  get(@Param('id') id: string): Promise<unknown> {
    return this.svc.get(id);
  }

  @Post()
  @RequireCap('inventory.count')
  @UsePipes(new ZodValidationPipe(StartCountSchema))
  start(@Body() body: StartCountInput): Promise<unknown> {
    return this.svc.start(body);
  }

  @Post(':id/apply')
  @RequireCap('inventory.count')
  @UsePipes(new ZodValidationPipe(ApplyCountSchema))
  apply(
    @Param('id') id: string,
    @Body() body: ApplyCountInput,
    @CurrentUser() user: AuthUser,
  ): Promise<unknown> {
    return this.svc.apply(id, body, user);
  }
}

@Module({
  controllers: [InventoryController],
  providers: [InventoryService, PrismaService],
})
export class InventoryModule {}
