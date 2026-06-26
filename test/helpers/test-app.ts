import { ValidationPipe, VersioningType, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import supertest from 'supertest';

import { runSeed } from '../../prisma/seed';
import { AppModule } from '../../src/app.module';

export const DEMO = {
  owner: 'youssef@elamrani.ma',
  admin: 'fatima@elamrani.ma',
  manager: 'karim@elamrani.ma',
  stockkeeper: 'hassan@elamrani.ma',
  cashier: 'salma@elamrani.ma',
} as const;

export const DEMO_PASSWORD = 'demo1234';

export async function bootTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return app;
}

export async function seedFresh(): Promise<void> {
  await runSeed({ silent: true });
}

export async function login(
  app: INestApplication,
  email: keyof typeof DEMO | string,
): Promise<{ accessToken: string; refreshToken: string; userId: string }> {
  const resolvedEmail = email in DEMO ? DEMO[email as keyof typeof DEMO] : email;
  const res = await supertest(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email: resolvedEmail, password: DEMO_PASSWORD })
    .expect(200);
  return {
    accessToken: res.body.accessToken,
    refreshToken: res.body.refreshToken,
    userId: res.body.user.id,
  };
}

export function api(app: INestApplication): ReturnType<typeof supertest> {
  return supertest(app.getHttpServer());
}

export function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}
