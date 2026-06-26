import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Module,
  Param,
  Patch,
  Post,
  Query,
  UsePipes,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PurchaseOrderStatus } from '@prisma/client';
import { z } from 'zod';

import type { AuthUser } from '../../common/auth/auth-user.type';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireCap } from '../../common/decorators/require-cap.decorator';
import { DomainError, NotFoundError } from '../../common/errors';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../common/prisma.service';

const VatEnum = z.union([z.literal(0), z.literal(7), z.literal(10), z.literal(14), z.literal(20)]);

const POLineSchema = z.object({
  productId: z.string().cuid(),
  qty: z.number().int().positive(),
  price: z.number().min(0),
  vat: VatEnum,
});

const CreatePOSchema = z.object({
  supplierId: z.string().cuid(),
  warehouseId: z.string().cuid(),
  lines: z.array(POLineSchema).min(1),
  notes: z.string().max(2000).optional(),
  status: z.enum(['draft', 'sent']).default('draft'),
});
type CreatePOInput = z.infer<typeof CreatePOSchema>;

const PatchPOSchema = z.object({
  status: z.enum(['draft', 'sent', 'cancelled']).optional(),
  notes: z.string().max(2000).optional(),
});
type PatchPOInput = z.infer<typeof PatchPOSchema>;

const ReceivePOSchema = z.object({
  lines: z
    .array(
      z.object({
        lineId: z.string().cuid(),
        qty: z.number().int().positive(),
      }),
    )
    .min(1),
});
type ReceivePOInput = z.infer<typeof ReceivePOSchema>;

const ListQuerySchema = z.object({
  status: z.enum(['draft', 'sent', 'partiallyReceived', 'received', 'cancelled']).optional(),
  supplierId: z.string().cuid().optional(),
  warehouseId: z.string().cuid().optional(),
});
type ListQuery = z.infer<typeof ListQuerySchema>;

const nextPONumber = async (prisma: PrismaService): Promise<string> => {
  const year = new Date().getFullYear();
  const last = await prisma.purchaseOrder.findFirst({
    where: { number: { startsWith: `BC-${year}-` } },
    orderBy: { number: 'desc' },
    select: { number: true },
  });
  const n = last ? parseInt(last.number.slice(8), 10) + 1 : 1;
  return `BC-${year}-${String(n).padStart(4, '0')}`;
};

@Injectable()
class POService {
  constructor(private readonly prisma: PrismaService) {}

  list(q: ListQuery): Promise<unknown> {
    const where: Record<string, unknown> = {};
    if (q.status) where.status = q.status;
    if (q.supplierId) where.supplierId = q.supplierId;
    if (q.warehouseId) where.warehouseId = q.warehouseId;
    return this.prisma.purchaseOrder.findMany({
      where,
      include: {
        supplier: { select: { id: true, name: true } },
        warehouse: { select: { id: true, name: true, city: true } },
        _count: { select: { lines: true } },
      },
      orderBy: { date: 'desc' },
    });
  }

  async get(id: string): Promise<unknown> {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: true,
        warehouse: true,
        lines: { include: { product: { select: { id: true, name: true, sku: true, tone: true } } } },
      },
    });
    if (!po) throw new NotFoundError('PurchaseOrder', id);
    return po;
  }

  async create(input: CreatePOInput): Promise<unknown> {
    const number = await nextPONumber(this.prisma);
    return this.prisma.purchaseOrder.create({
      data: {
        number,
        supplierId: input.supplierId,
        warehouseId: input.warehouseId,
        status: input.status,
        ...(input.notes ? { notes: input.notes } : {}),
        lines: { create: input.lines.map((l) => ({ ...l, received: 0 })) },
      },
      include: { lines: true },
    });
  }

  async patch(id: string, input: PatchPOInput): Promise<unknown> {
    const existing = await this.prisma.purchaseOrder.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('PurchaseOrder', id);
    if (existing.status === 'received' || existing.status === 'partiallyReceived') {
      throw new DomainError('immutable', 'Cannot edit a received PO', 422);
    }
    const data: Record<string, unknown> = {};
    if (input.status !== undefined) data.status = input.status;
    if (input.notes !== undefined) data.notes = input.notes;
    return this.prisma.purchaseOrder.update({ where: { id }, data });
  }

  async remove(id: string): Promise<void> {
    const existing = await this.prisma.purchaseOrder.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('PurchaseOrder', id);
    if (existing.status === 'received' || existing.status === 'partiallyReceived') {
      throw new DomainError('immutable', 'Cannot delete a received PO', 422);
    }
    await this.prisma.purchaseOrder.delete({ where: { id } });
  }

  /**
   * Receive PO lines. For each {lineId, qty} input:
   *  - Cap qty to (line.qty - line.received).
   *  - Emit Movement{in, achat, ref:po.number}.
   *  - Increment StockLevel at po.warehouseId.
   *  - Increment line.received.
   * Then recompute PO status (received / partiallyReceived). Atomic transaction.
   */
  async receive(id: string, input: ReceivePOInput, actor: AuthUser): Promise<unknown> {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!po) throw new NotFoundError('PurchaseOrder', id);
    if (po.status === 'cancelled') {
      throw new DomainError('cancelled_po', 'Cannot receive a cancelled PO', 422);
    }

    const lineById = new Map(po.lines.map((l) => [l.id, l]));
    for (const r of input.lines) {
      const line = lineById.get(r.lineId);
      if (!line) throw new NotFoundError('POLine', r.lineId);
      if (r.qty + line.received > line.qty) {
        throw new DomainError(
          'over_receive',
          `Line ${line.id}: receive qty exceeds remaining (${r.qty} > ${line.qty - line.received})`,
          422,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      for (const r of input.lines) {
        const line = lineById.get(r.lineId)!;
        await tx.stockLevel.upsert({
          where: {
            productId_warehouseId: { productId: line.productId, warehouseId: po.warehouseId },
          },
          create: { productId: line.productId, warehouseId: po.warehouseId, qty: r.qty },
          update: { qty: { increment: r.qty } },
        });
        await tx.movement.create({
          data: {
            type: 'in',
            productId: line.productId,
            qty: r.qty,
            warehouseId: po.warehouseId,
            userId: actor.id,
            reason: 'achat',
            ref: po.number,
          },
        });
        await tx.purchaseOrderLine.update({
          where: { id: line.id },
          data: { received: { increment: r.qty } },
        });
      }

      const fresh = await tx.purchaseOrder.findUniqueOrThrow({
        where: { id },
        include: { lines: true },
      });
      const totalQty = fresh.lines.reduce((s, l) => s + l.qty, 0);
      const totalRcvd = fresh.lines.reduce((s, l) => s + l.received, 0);
      const newStatus: PurchaseOrderStatus =
        totalRcvd >= totalQty ? 'received' : 'partiallyReceived';

      await tx.purchaseOrder.update({ where: { id }, data: { status: newStatus } });
      await tx.activity.create({
        data: {
          userId: actor.id,
          action: 'po.received',
          desc: `Réception ${po.number} — ${input.lines.reduce((s, l) => s + l.qty, 0)} unité(s)`,
          ...(actor.device ? { device: actor.device } : {}),
        },
      });
      return tx.purchaseOrder.findUniqueOrThrow({
        where: { id },
        include: {
          supplier: { select: { id: true, name: true } },
          warehouse: { select: { id: true, name: true } },
          lines: true,
        },
      });
    });
  }
}

@ApiTags('purchase-orders')
@ApiBearerAuth()
@Controller({ path: 'purchase-orders', version: '1' })
class POController {
  constructor(private readonly svc: POService) {}

  @Get()
  @RequireCap('po.manage')
  list(@Query(new ZodValidationPipe(ListQuerySchema)) query: ListQuery): Promise<unknown> {
    return this.svc.list(query);
  }

  @Get(':id')
  @RequireCap('po.manage')
  get(@Param('id') id: string): Promise<unknown> {
    return this.svc.get(id);
  }

  @Post()
  @RequireCap('po.manage')
  @UsePipes(new ZodValidationPipe(CreatePOSchema))
  create(@Body() body: CreatePOInput): Promise<unknown> {
    return this.svc.create(body);
  }

  @Patch(':id')
  @RequireCap('po.manage')
  @UsePipes(new ZodValidationPipe(PatchPOSchema))
  patch(@Param('id') id: string, @Body() body: PatchPOInput): Promise<unknown> {
    return this.svc.patch(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireCap('po.manage')
  async remove(@Param('id') id: string): Promise<void> {
    await this.svc.remove(id);
  }

  @Post(':id/receive')
  @RequireCap('po.manage')
  @UsePipes(new ZodValidationPipe(ReceivePOSchema))
  receive(
    @Param('id') id: string,
    @Body() body: ReceivePOInput,
    @CurrentUser() user: AuthUser,
  ): Promise<unknown> {
    return this.svc.receive(id, body, user);
  }
}

@Module({
  controllers: [POController],
  providers: [POService, PrismaService],
})
export class PurchaseOrdersModule {}
