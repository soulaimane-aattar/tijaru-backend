import { loadEnv } from './env';

describe('env', () => {
  it('parses platform admin credentials', () => {
    const prev = { ...process.env };
    process.env.DATABASE_URL = 'postgresql://stock:stock@localhost:5432/stock?schema=public';
    process.env.JWT_ACCESS_SECRET = 'change-me-access-secret-min-32-chars-xxxxx';
    process.env.JWT_REFRESH_SECRET = 'change-me-refresh-secret-min-32-chars-xxxx';
    process.env.PLATFORM_ADMIN_EMAIL = 'boss@platform.io';
    process.env.PLATFORM_ADMIN_PASSWORD = 'supersecret';
    const env = loadEnv();
    expect(env.PLATFORM_ADMIN_EMAIL).toBe('boss@platform.io');
    expect(env.PLATFORM_ADMIN_PASSWORD).toBe('supersecret');
    process.env = prev;
  });
});
