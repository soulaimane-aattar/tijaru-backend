import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),
  BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),
  RATE_LIMIT_LOGIN_PER_MIN: z.coerce.number().int().positive().default(5),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173,http://localhost:8081')
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean)),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  PLATFORM_ADMIN_EMAIL: z.string().email(),
  PLATFORM_ADMIN_PASSWORD: z.string().min(8),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment configuration');
  }
  return parsed.data;
}
