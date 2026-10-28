import { Injectable } from '@nestjs/common';

import { Db } from '../../../database';
import {
  DeliveryPdfInfoLookup,
  type PdfBusinessInfo,
  type PdfPartyInfo,
} from '../domain/delivery-notes.repository';

/** Kysely-backed lookup for the business letterhead + counterparty contact block on the bon PDF. */
@Injectable()
export class KyselyDeliveryPdfInfoLookup extends DeliveryPdfInfoLookup {
  constructor(private readonly db: Db) {
    super();
  }

  async getBusiness(businessId: string): Promise<PdfBusinessInfo | null> {
    const b = await this.db.q
      .selectFrom('app.businesses')
      .select(['name', 'address', 'ice', 'phone', 'logo'])
      .where('id', '=', businessId)
      .executeTakeFirst();
    return b ?? null;
  }

  async getCustomer(businessId: string, customerId: string): Promise<PdfPartyInfo | null> {
    const c = await this.db.q
      .selectFrom('app.customers')
      .select(['name', 'phone', 'city'])
      .where('business_id', '=', businessId)
      .where('id', '=', customerId)
      .executeTakeFirst();
    return c ? { name: c.name, phone: c.phone, address: c.city } : null;
  }

  async getSupplier(businessId: string, supplierId: string): Promise<PdfPartyInfo | null> {
    const s = await this.db.q
      .selectFrom('app.suppliers')
      .select(['name', 'phone', 'city'])
      .where('business_id', '=', businessId)
      .where('id', '=', supplierId)
      .executeTakeFirst();
    return s ? { name: s.name, phone: s.phone, address: s.city } : null;
  }
}
