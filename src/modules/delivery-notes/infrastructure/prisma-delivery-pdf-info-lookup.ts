import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma.service';
import {
  DeliveryPdfInfoLookup,
  type PdfBusinessInfo,
  type PdfPartyInfo,
} from '../domain/delivery-notes.repository';

/** Prisma-backed lookup for the business letterhead + counterparty contact block on the bon PDF. */
@Injectable()
export class PrismaDeliveryPdfInfoLookup extends DeliveryPdfInfoLookup {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async getBusiness(businessId: string): Promise<PdfBusinessInfo | null> {
    const b = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { name: true, address: true, ice: true, phone: true, logo: true },
    });
    return b ?? null;
  }

  async getCustomer(businessId: string, customerId: string): Promise<PdfPartyInfo | null> {
    const c = await this.prisma.customer.findFirst({
      where: { id: customerId, businessId },
      select: { name: true, phone: true, city: true },
    });
    return c ? { name: c.name, phone: c.phone, address: c.city } : null;
  }

  async getSupplier(businessId: string, supplierId: string): Promise<PdfPartyInfo | null> {
    const s = await this.prisma.supplier.findFirst({
      where: { id: supplierId, businessId },
      select: { name: true, phone: true, city: true },
    });
    return s ? { name: s.name, phone: s.phone, address: s.city } : null;
  }
}
