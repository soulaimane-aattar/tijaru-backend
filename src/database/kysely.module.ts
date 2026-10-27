import { Global, Module, OnModuleDestroy, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DB } from './types';

export const KYSELY = Symbol('KYSELY');

@Global()
@Module({
  providers: [
    {
      provide: KYSELY,
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('DATABASE_URL_APP');
        const fallback = config.get<string>('DATABASE_URL');

        const pool = new Pool({
          connectionString: url || fallback,
        });

        return new Kysely<DB>({
          dialect: new PostgresDialect({ pool }),
        });
      },
      inject: [ConfigService],
    },
  ],
  exports: [KYSELY],
})
export class KyselyModule implements OnModuleDestroy {
  constructor(@Inject(KYSELY) private readonly db: Kysely<DB>) {}

  async onModuleDestroy() {
    await this.db.destroy();
  }
}
