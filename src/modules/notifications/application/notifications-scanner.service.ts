import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { NotificationsRepository } from '../domain/notifications.repository';

export type ScanResult = { lowStock: number; expiring: number };

const EXPIRY_WINDOW_DAYS = 30;

@Injectable()
export class NotificationsScannerService {
  private readonly logger = new Logger(NotificationsScannerService.name);

  constructor(private readonly repo: NotificationsRepository) {}

  @Cron('0 6 * * *')
  scheduledScan(): Promise<ScanResult> {
    return this.scanNow();
  }

  async scanNow(): Promise<ScanResult> {
    const [lowStockRows, expiringRows] = await Promise.all([
      this.repo.findLowStockCandidates(),
      this.repo.findExpiringCandidates(EXPIRY_WINDOW_DAYS),
    ]);

    let lowStock = 0;
    for (const r of lowStockRows) {
      const type = r.totalQty === 0 ? 'outOfStock' : 'lowStock';
      const body =
        r.totalQty === 0
          ? `${r.productName} · rupture (seuil ${r.minStock})`
          : `${r.productName} · stock ${r.totalQty} (seuil ${r.minStock})`;
      if (await this.repo.existsUnread(r.businessId, type, body)) continue;
      await this.repo.create({ businessId: r.businessId, type, title: r.productName, body });
      lowStock++;
    }

    let expiring = 0;
    for (const r of expiringRows) {
      const daysLeft = Math.ceil((r.expiry.getTime() - Date.now()) / 86400000);
      const body = `${r.name} · expire dans ${daysLeft}j (${r.expiry.toISOString().slice(0, 10)})`;
      if (await this.repo.existsUnread(r.businessId, 'expiring', body)) continue;
      await this.repo.create({ businessId: r.businessId, type: 'expiring', title: r.name, body });
      expiring++;
    }

    this.logger.log(`Scan complete: ${lowStock} lowStock/outOfStock, ${expiring} expiring`);
    return { lowStock, expiring };
  }
}
