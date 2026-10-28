import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { MailService } from '../../../common/mail/mail.service';
import { inactivityReminder, subscriptionExpiring } from '../../../common/mail/mail.templates';
import { ENV_TOKEN } from '../../../config/config.module';
import type { Env } from '../../../config/env';
import { Db } from '../../../database';

const DAY = 86_400_000;
/** Days before subscription end at which the owner is reminded. */
export const EXPIRY_REMINDER_DAYS = [7, 3, 1];
/** Days without a login at which the owner is nudged. */
export const INACTIVITY_REMINDER_DAYS = [14, 30];

/**
 * Daily reminder emails to business owners. Each reminder fires when the day count lands in
 * exactly one 24h window, so the daily cron is its own dedupe — no sent-flag column.
 * ponytail: a skipped run (API down at 08:00) skips that day's reminders; add a sent-log if that matters.
 */
@Injectable()
export class EmailRemindersService {
  private readonly logger = new Logger(EmailRemindersService.name);

  constructor(
    private readonly db: Db,
    private readonly mail: MailService,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {}

  @Cron('0 8 * * *')
  async scheduledRun(): Promise<void> {
    const sent = await this.run(new Date());
    this.logger.log(`Reminder emails — expiry: ${sent.expiry}, inactivity: ${sent.inactivity}`);
  }

  async run(now: Date): Promise<{ expiry: number; inactivity: number }> {
    return { expiry: await this.remindExpiring(now), inactivity: await this.remindInactive(now) };
  }

  // Cron, no tenant, cross-business by design → owner pool.
  private async remindExpiring(now: Date): Promise<number> {
    let sent = 0;
    for (const daysLeft of EXPIRY_REMINDER_DAYS) {
      const businesses = await this.db.admin
        .selectFrom('app.businesses')
        .select(['id', 'name', 'subscription_end'])
        .where('status', '=', 'active')
        .where('plan', 'in', ['trial', 'active'])
        .where('subscription_end', '>', new Date(now.getTime() + (daysLeft - 1) * DAY))
        .where('subscription_end', '<=', new Date(now.getTime() + daysLeft * DAY))
        .execute();
      if (businesses.length === 0) continue;
      const owners = await this.db.admin
        .selectFrom('app_auth.users')
        .select(['business_id', 'name', 'email'])
        .where('business_id', 'in', businesses.map((b) => b.id))
        .where('role', '=', 'owner')
        .where('active', '=', true)
        .where('deletedAt', 'is', null)
        .orderBy('createdAt', 'asc')
        .execute();
      for (const b of businesses) {
        const owner = owners.find((o) => o.business_id === b.id);
        if (!owner || !b.subscription_end) continue;
        const mail = subscriptionExpiring(
          { ownerName: owner.name, businessName: b.name, daysLeft, endDate: b.subscription_end },
          this.env.APP_URL,
        );
        if (await this.mail.send(owner.email, mail)) sent++;
      }
    }
    return sent;
  }

  private async remindInactive(now: Date): Promise<number> {
    let sent = 0;
    for (const days of INACTIVITY_REMINDER_DAYS) {
      const gt = new Date(now.getTime() - (days + 1) * DAY);
      const lte = new Date(now.getTime() - days * DAY);
      const owners = await this.db.admin
        .selectFrom('app_auth.users as u')
        .innerJoin('app.businesses as b', 'b.id', 'u.business_id')
        .select(['u.name', 'u.email', 'b.name as business_name'])
        .where('u.role', '=', 'owner')
        .where('u.active', '=', true)
        .where('u.deletedAt', 'is', null)
        .where('b.status', '=', 'active')
        .where('b.plan', 'in', ['trial', 'active'])
        // never-logged-in owners count from account creation
        .where((eb) =>
          eb.or([
            eb.and([eb('u.lastLogin', '>', gt), eb('u.lastLogin', '<=', lte)]),
            eb.and([eb('u.lastLogin', 'is', null), eb('u.createdAt', '>', gt), eb('u.createdAt', '<=', lte)]),
          ]),
        )
        .execute();
      for (const o of owners) {
        const mail = inactivityReminder({ ownerName: o.name, businessName: o.business_name, days }, this.env.APP_URL);
        if (await this.mail.send(o.email, mail)) sent++;
      }
    }
    return sent;
  }
}
