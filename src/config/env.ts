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
  /** Root directory for receipt images. Relative paths resolve from the API's cwd. */
  UPLOADS_DIR: z.string().default('./uploads'),
  /** Compose-network address of the Python OCR service. */
  OCR_SERVICE_URL: z.string().url().default('http://ocr:8000'),
  OCR_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  /** Only read by `seed:platform-admin`; unused at app boot — optional so prod doesn't need it once the admin exists. */
  /** Super-admin session length (after 2FA). Longer than users' 15m: there is no refresh token to renew it. */
  PLATFORM_ADMIN_TTL: z.string().default('1h'),
  /** Outgoing mail. Without SMTP_HOST mail is disabled (calls are no-ops), so dev/CI need no server. */
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  /** true = implicit TLS (port 465); false = STARTTLS when the server offers it (587). */
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('Tijaru <no-reply@tijaru.com>'),
  /** Public web URL used for links in emails. */
  APP_URL: z.string().url().default('https://tijaru.com'),
  PLATFORM_ADMIN_EMAIL: z.string().email().optional(),
  PLATFORM_ADMIN_PASSWORD: z.string().min(8).optional(),
  /**
   * Serve Swagger at /api/docs. Left unset it follows NODE_ENV, so production
   * never publishes the API map. The dockerised dev stack runs with
   * NODE_ENV=production, hence the explicit override there.
   */
  SWAGGER_ENABLED: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
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
