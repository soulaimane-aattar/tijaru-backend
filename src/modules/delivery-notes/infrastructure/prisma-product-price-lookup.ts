import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma.service';
import { ProductPriceLookup } from '../domain/delivery-notes.repository';

const dec = (n: number | Prisma.Decimal): number =>
  typeof n === 'number' ? n : Number(n.toString());

/**
 * Prisma-backed price lookup used to prefill a delivery-note line's
 * `unitPrice` when the caller omits it. Uses the product's `sale` price
 * (the sell/HT price already used elsewhere, e.g. POS) as the default.
 */
@Injectable()
export class PrismaProductPriceLookup extends ProductPriceLookup {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findById(
    businessId: string,
    productId: string,
  ): Promise<{ id: string; price: number } | null> {
    const p = await this.prisma.product.findFirst({
      where: { id: productId, businessId, deletedAt: null },
      select: { id: true, sale: true },
    });
    return p ? { id: p.id, price: dec(p.sale) } : null;
  }
}
