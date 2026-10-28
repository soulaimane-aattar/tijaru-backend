import { Injectable } from '@nestjs/common';

import { Db } from '../../../database';
import { BusinessInfoLookup, type BusinessInfo } from '../domain/business-info.lookup';

/** Kysely-backed lookup for the business letterhead on the expense report PDF. */
@Injectable()
export class KyselyBusinessInfoLookup extends BusinessInfoLookup {
  constructor(private readonly db: Db) {
    super();
  }

  async get(businessId: string): Promise<BusinessInfo | null> {
    const b = await this.db.q
      .selectFrom('app.businesses')
      .select(['name', 'address', 'ice', 'phone'])
      .where('id', '=', businessId)
      .executeTakeFirst();
    return b ?? null;
  }
}
