import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { MailService } from '../../../common/mail/mail.service';
import { inactivityReminder, subscriptionExpiring } from '../../../common/mail/mail.templates';
import { PrismaService } from '../../../common/prisma.service';
import { ENV_TOKEN } from '../../../config/config.module';
import type { Env } from '../../../config/env';

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
    private readonly prisma: PrismaService,
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

  private async remindExpiring(now: Date): Promise<number> {
    let sent = 0;
    for (const daysLeft of EXPIRY_REMINDER_DAYS) {
      const businesses = await this.prisma.business.findMany({
        where: {
          status: 'active',
          plan: { in: ['trial', 'active'] },
          subscriptionEnd: { gt: new Date(now.getTime() + (daysLeft - 1) * DAY), lte: new Date(now.getTime() + daysLeft * DAY) },
        },
        select: {
          name: true,
          subscriptionEnd: true,
          users: { where: { role: 'owner', active: true, deletedAt: null }, select: { name: true, email: true }, take: 1 },
        },
      });
      for (const b of businesses) {
        const owner = b.users[0];
        if (!owner || !b.subscriptionEnd) continue;
        const mail = subscriptionExpiring(
          { ownerName: owner.name, businessName: b.name, daysLeft, endDate: b.subscriptionEnd },
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
      const window = { gt: new Date(now.getTime() - (days + 1) * DAY), lte: new Date(now.getTime() - days * DAY) };
      const owners = await this.prisma.user.findMany({
        where: {
          role: 'owner',
          active: true,
          deletedAt: null,
          business: { status: 'active', plan: { in: ['trial', 'active'] } },
          // never-logged-in owners count from account creation
          OR: [{ lastLogin: window }, { lastLogin: null, createdAt: window }],
        },
        select: { name: true, email: true, business: { select: { name: true } } },
      });
      for (const o of owners) {
        const mail = inactivityReminder({ ownerName: o.name, businessName: o.business.name, days }, this.env.APP_URL);
        if (await this.mail.send(o.email, mail)) sent++;
      }
    }
    return sent;
  }
}
