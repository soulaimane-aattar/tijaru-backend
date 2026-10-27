import { Global, Module } from '@nestjs/common';

import { MailService } from './mail.service';

/** Global: any feature can inject `MailService` to send transactional email. */
@Global()
@Module({ providers: [MailService], exports: [MailService] })
export class MailModule {}
