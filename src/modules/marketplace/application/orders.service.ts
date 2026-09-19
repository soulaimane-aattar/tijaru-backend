import { Injectable } from '@nestjs/common';
import type { OrderStatus } from '@prisma/client';

import type { AuthUser } from '../../../common/auth/auth-user.type';
import { DomainError, NotFoundError } from '../../../common/errors';
import { allowedNext, assertTransition, type Actor } from '../domain/order-state-machine';
import type {
  ListOrdersResult,
  OrderDetail,
  OrderLineData,
} from '../domain/orders.repository';
import { OrdersRepository } from '../domain/orders.repository';
import { resolveUnitPrice } from '../domain/pricing';
import type { CreateOrderInput, ListOrdersQuery } from '../dto/orders.dto';

const round2 = (n: number): number => Math.round(n * 100) / 100;
const PREFIX = (year: number): string => `CMD-${year}-`;

export type OrderView = OrderDetail & { allowedNext: OrderStatus[]; side: Actor };

@Injectable()
export class OrdersService {
  constructor(private readonly repo: OrdersRepository) {}

  /**
   * Place an order as the buyer tenant. Prices are resolved server-side from
   * the seller's ladder — whatever the client sent is ignored.
   */
  async create(input: CreateOrderInput, actor: AuthUser): Promise<OrderView> {
    const listings = await this.repo.findListings(input.lines.map((l) => l.listingId));
    const byId = new Map(listings.map((l) => [l.id, l]));

    const sellerIds = new Set(listings.map((l) => l.sellerBusinessId));
    if (sellerIds.size > 1) {
      throw new DomainError('multiple_sellers', 'An order cannot span several sellers', 422);
    }
    const seller = [...sellerIds][0];
    if (!seller) throw new NotFoundError('Listing');
    if (seller === actor.businessId) {
      throw new DomainError('self_order', 'You cannot order from your own catalog', 422);
    }

    const buyerName = await this.repo.businessName(actor.businessId);
    const customer = await this.repo.ensureCustomer(seller, actor.businessId, buyerName);

    let subtotalHt = 0;
    let vatTotal = 0;
    const lines: OrderLineData[] = input.lines.map((l) => {
      const listing = byId.get(l.listingId);
      if (!listing || !listing.active) throw new NotFoundError('Listing', l.listingId);
      if (l.qty < listing.minOrderQty) {
        throw new DomainError(
          'below_min_order_qty',
          `${listing.title} requires at least ${listing.minOrderQty}`,
          422,
        );
      }
      const unitPrice = resolveUnitPrice(
        listing.unitPrice,
        listing.tiers,
        customer.priceGroupId,
        l.qty,
      );
      const totalHt = round2(unitPrice * l.qty);
      subtotalHt += totalHt;
      vatTotal += (totalHt * listing.vat) / 100;
      return {
        listingId: listing.id,
        productId: listing.productId,
        name: listing.title,
        qty: l.qty,
        unitPrice,
        vat: listing.vat,
        totalHt,
      };
    });
    subtotalHt = round2(subtotalHt);
    vatTotal = round2(vatTotal);

    const number = await this.repo.nextNumber(seller, PREFIX(new Date().getFullYear()));

    const order = await this.repo.create({
      number,
      sellerBusinessId: seller,
      buyerBusinessId: actor.businessId,
      customerId: customer.id,
      subtotalHt,
      vatTotal,
      totalTtc: round2(subtotalHt + vatTotal),
      buyerNote: input.note ?? null,
      createdByUserId: actor.id,
      lines,
    });

    await this.repo.notify(
      seller,
      'orderReceived',
      `Nouvelle commande ${order.number}`,
      `${buyerName} a commandé ${lines.length} article(s) — ${order.totalTtc} MAD`,
    );

    return this.view(order, 'buyer');
  }

  async list(businessId: string, side: Actor, query: ListOrdersQuery): Promise<ListOrdersResult> {
    return this.repo.list({
      businessId,
      side,
      ...(query.status ? { status: query.status } : {}),
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  async get(businessId: string, id: string): Promise<OrderView> {
    const order = await this.repo.findDetail(id);
    const side = this.sideOf(order, businessId, id);
    return this.view(order as OrderDetail, side);
  }

  /** Seller and buyer share this entry point; the FSM decides who may do what. */
  async transition(
    id: string,
    to: OrderStatus,
    actor: AuthUser,
    note?: string,
  ): Promise<OrderView> {
    const order = await this.repo.findDetail(id);
    const side = this.sideOf(order, actor.businessId, id);
    const current = order as OrderDetail;

    assertTransition(current.status, to, side);

    const updated = await this.repo.transition(id, to, actor.id, {
      postStock: to === 'shipped',
      note: side === 'seller' ? note : undefined,
    });

    const counterparty =
      side === 'seller' ? updated.buyerBusinessId : updated.sellerBusinessId;
    await this.repo.notify(
      counterparty,
      'orderStatus',
      `Commande ${updated.number} — ${to}`,
      side === 'seller'
        ? `${updated.sellerName} a mis à jour votre commande : ${to}`
        : `${updated.buyerName} a annulé la commande`,
    );

    return this.view(updated, side);
  }

  private sideOf(order: OrderDetail | null, businessId: string, id: string): Actor {
    if (!order) throw new NotFoundError('Order', id);
    if (order.sellerBusinessId === businessId) return 'seller';
    if (order.buyerBusinessId === businessId) return 'buyer';
    // Third parties must not learn that the id exists.
    throw new NotFoundError('Order', id);
  }

  private view(order: OrderDetail, side: Actor): OrderView {
    return { ...order, side, allowedNext: allowedNext(order.status, side) };
  }
}
