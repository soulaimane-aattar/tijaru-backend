import { Inject, Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';

import type { Mail } from './mail.templates';

/**
 * Best-effort transactional email: `send` never throws, so a mail outage can't fail the
 * business action that triggered it. With no SMTP_HOST it is a no-op.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: Transporter | null;

  constructor(@Inject(ENV_TOKEN) private readonly env: Env) {
    this.transport = env.SMTP_HOST
      ? createTransport({
          host: env.SMTP_HOST,
          port: env.SMTP_PORT,
          secure: env.SMTP_SECURE,
          ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS ?? '' } } : {}),
        })
      : null;
  }

  async send(to: string, mail: Mail): Promise<boolean> {
    if (!this.transport) {
      this.logger.debug(`SMTP not configured — skipped "${mail.subject}"`);
      return false;
    }
    try {
      await this.transport.sendMail({ from: this.env.MAIL_FROM, to, ...mail });
      return true;
    } catch (err) {
      this.logger.warn(`Mail "${mail.subject}" failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }
}
