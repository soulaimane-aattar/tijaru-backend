import { Injectable } from '@nestjs/common';
import { Prisma, type NotificationType, type OrderStatus } from '@prisma/client';

import { ValidationError } from '../../../common/errors';
import { PrismaService } from '../../../common/prisma.service';
import { TenantContext } from '../../../common/tenant/tenant-context';
import { StockLedgerService } from '../../stock-ledger/application/stock-ledger.service';
import type {
  ListOrdersParams,
  ListOrdersResult,
  OrderCreateData,
  OrderDetail,
  OrderRow,
  OrderableListing,
} from '../domain/orders.repository';
import { OrdersRepository } from '../domain/orders.repository';

import { SELLABLE_SELLER } from './sellable-seller';

const dec = (n: number | Prisma.Decimal): number =>
  typeof n === 'number' ? n : Number(n.toString());

const DETAIL_INCLUDE = {
  lines: true,
  seller: { select: { name: true } },
  buyer: { select: { name: true } },
} as const;

type OrderWithRelations = Prisma.OrderGetPayload<{ include: typeof DETAIL_INCLUDE }>;

function toDetail(o: OrderWithRelations): OrderDetail {
  return {
    id: o.id,
    number: o.number,
    status: o.status,
    sellerBusinessId: o.sellerBusinessId,
    sellerName: o.seller.name,
    buyerBusinessId: o.buyerBusinessId,
    buyerName: o.buyer.name,
    subtotalHt: dec(o.subtotalHt),
    vatTotal: dec(o.vatTotal),
    totalTtc: dec(o.totalTtc),
    buyerNote: o.buyerNote,
    sellerNote: o.sellerNote,
    externalRef: o.externalRef,
    createdAt: o.createdAt,
    statusChangedAt: o.statusChangedAt,
    lines: o.lines.map((l) => ({
      id: l.id,
      listingId: l.listingId,
      productId: l.productId,
      name: l.name,
      qty: l.qty,
      unitPrice: dec(l.unitPrice),
      vat: l.vat,
      totalHt: dec(l.totalHt),
    })),
  };
}

/** List rows carry the header only — no lines, notes or external refs. */
function toRow(o: OrderWithRelations): OrderRow {
  const d = toDetail(o);
  return {
    id: d.id,
    number: d.number,
    status: d.status,
    sellerBusinessId: d.sellerBusinessId,
    sellerName: d.sellerName,
    buyerBusinessId: d.buyerBusinessId,
    buyerName: d.buyerName,
    subtotalHt: d.subtotalHt,
    vatTotal: d.vatTotal,
    totalTtc: d.totalTtc,
    createdAt: d.createdAt,
    statusChangedAt: d.statusChangedAt,
  };
}

@Injectable()
export class PrismaOrdersRepository extends OrdersRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
    private readonly ledger: StockLedgerService,
  ) {
    super();
  }

  async findListings(ids: string[]): Promise<OrderableListing[]> {
    const rows = await this.prisma.listing.findMany({
      // Same seller-state gate as the catalog: a listing whose owner is
      // suspended, expired or has the module off is not orderable.
      where: { id: { in: ids }, business: SELLABLE_SELLER },
      include: { tiers: true },
    });
    return rows.map((l) => ({
      id: l.id,
      sellerBusinessId: l.businessId,
      productId: l.productId,
      title: l.title,
      unitPrice: dec(l.unitPrice),
      vat: l.vat,
      minOrderQty: l.minOrderQty,
      active: l.active,
      tiers: l.tiers.map((t) => ({
        priceGroupId: t.priceGroupId,
        minQty: t.minQty,
        unitPrice: dec(t.unitPrice),
      })),
    }));
  }

  async ensureCustomer(
    sellerBusinessId: string,
    buyerBusinessId: string,
    buyerName: string,
  ): Promise<{ id: string; priceGroupId: string | null }> {
    // Customer is tenant-scoped: run as the seller, and await inside the scope
    // (Prisma promises are lazy — D-030).
    return this.tenant.run(sellerBusinessId, async () => {
      const existing = await this.prisma.customer.findFirst({
        where: { businessId: sellerBusinessId, buyerBusinessId },
        select: { id: true, priceGroupId: true },
      });
      if (existing) return existing;

      const fallback = await this.prisma.priceGroup.findFirst({
        where: { businessId: sellerBusinessId, isDefault: true },
        select: { id: true },
      });
      return this.prisma.customer.create({
        data: {
          businessId: sellerBusinessId,
          name: buyerName,
          buyerBusinessId,
          priceGroupId: fallback?.id ?? null,
        },
        select: { id: true, priceGroupId: true },
      });
    });
  }

  async nextNumber(sellerBusinessId: string, prefix: string): Promise<string> {
    const last = await this.prisma.order.findFirst({
      where: { sellerBusinessId, number: { startsWith: prefix } },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    const n = last ? parseInt(last.number.slice(prefix.length), 10) || 0 : 0;
    return `${prefix}${String(n + 1).padStart(4, '0')}`;
  }

  /**
   * `nextNumber` reads the highest number and adds one, so two orders placed
   * with the same seller at the same instant pick the same one and the second
   * trips `@@unique([sellerBusinessId, number])`. Retry on that collision with
   * a freshly-read number rather than surfacing a 500.
   */
  async create(data: OrderCreateData): Promise<OrderDetail> {
    const { lines, ...header } = data;
    let number = header.number;

    for (let attempt = 0; ; attempt += 1) {
      try {
        const order = await this.prisma.order.create({
          data: { ...header, number, lines: { create: lines } },
          include: DETAIL_INCLUDE,
        });
        return toDetail(order);
      } catch (e) {
        const collided =
          e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && attempt < 5;
        if (!collided) throw e;
        number = await this.nextNumber(header.sellerBusinessId, number.slice(0, -4));
      }
    }
  }

  async findDetail(id: string): Promise<OrderDetail | null> {
    const row = await this.prisma.order.findUnique({ where: { id }, include: DETAIL_INCLUDE });
    return row ? toDetail(row) : null;
  }

  async list(params: ListOrdersParams): Promise<ListOrdersResult> {
    const where: Prisma.OrderWhereInput = {
      ...(params.side === 'seller'
        ? { sellerBusinessId: params.businessId }
        : { buyerBusinessId: params.businessId }),
      ...(params.status ? { status: params.status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: DETAIL_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.order.count({ where }),
    ]);
    return { items: rows.map(toRow), total, page: params.page, pageSize: params.pageSize };
  }

  async transition(
    id: string,
    to: OrderStatus,
    actorUserId: string,
    opts: { postStock: boolean; note?: string | undefined },
  ): Promise<OrderDetail> {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id },
      include: { lines: true },
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      if (opts.postStock) {
        const warehouse = await tx.warehouse.findFirst({
          where: { businessId: order.sellerBusinessId, active: true, deletedAt: null },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
          select: { id: true },
        });
        if (!warehouse) throw new ValidationError('no_default_warehouse');

        // D-017: the ledger is the only writer of StockLevel/Movement. It also
        // enforces the stock floor, throwing ConflictError('insufficient_stock').
        await this.ledger.post(
          {
            businessId: order.sellerBusinessId,
            userId: actorUserId,
            type: 'out',
            reason: 'vente',
            ref: order.number,
            lines: order.lines.map((l) => ({
              productId: l.productId,
              warehouseId: warehouse.id,
              delta: -l.qty,
            })),
          },
          tx,
        );
      }

      return tx.order.update({
        where: { id },
        data: {
          status: to,
          statusChangedAt: new Date(),
          ...(opts.note === undefined ? {} : { sellerNote: opts.note }),
        },
        include: DETAIL_INCLUDE,
      });
    });

    return toDetail(updated);
  }

  async notify(
    businessId: string,
    type: NotificationType,
    title: string,
    body: string,
  ): Promise<void> {
    // Notification is tenant-scoped and the recipient is the *other* tenant.
    await this.tenant.run(businessId, async () =>
      this.prisma.notification.create({ data: { businessId, type, title, body } }),
    );
  }

  async businessName(id: string): Promise<string> {
    const b = await this.prisma.business.findUniqueOrThrow({
      where: { id },
      select: { name: true },
    });
    return b.name;
  }
}
