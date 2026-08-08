import * as bcrypt from 'bcrypt';

import { UnauthorizedError } from '../../common/errors';

import { PlatformAdminService } from './platform-admin.service';

type MockPrisma = {
  platformAdmin: { findUnique: jest.Mock };
  business: { findMany: jest.Mock; update: jest.Mock; findUnique: jest.Mock };
};

const mockPrisma = (): MockPrisma => ({
  platformAdmin: {
    findUnique: jest.fn(),
  },
  business: {
    findMany: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
  },
});

const mockJwt = () => ({ signAsync: jest.fn().mockResolvedValue('pa-token') }) as never;

const mockEnv = {
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_ACCESS_TTL: '15m',
} as never;

describe('PlatformAdminService', () => {
  it('returns accessToken on valid credentials', async () => {
    const prisma = mockPrisma();
    const hash = await bcrypt.hash('admin123', 4);
    prisma.platformAdmin.findUnique.mockResolvedValue({
      id: 'pa1',
      email: 'admin@tijaru.com',
      passwordHash: hash,
      tokenVersion: 0,
    });
    const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
    const result = await svc.login('admin@tijaru.com', 'admin123');
    expect(result.accessToken).toBe('pa-token');
  });

  it('throws UnauthorizedError on wrong password', async () => {
    const prisma = mockPrisma();
    const hash = await bcrypt.hash('admin123', 4);
    prisma.platformAdmin.findUnique.mockResolvedValue({
      id: 'pa1',
      email: 'admin@tijaru.com',
      passwordHash: hash,
      tokenVersion: 0,
    });
    const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
    await expect(svc.login('admin@tijaru.com', 'wrong')).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('throws UnauthorizedError when admin not found', async () => {
    const prisma = mockPrisma();
    prisma.platformAdmin.findUnique.mockResolvedValue(null);
    const svc = new PlatformAdminService(prisma as never, mockJwt(), mockEnv);
    await expect(svc.login('ghost@tijaru.com', 'pass')).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });
});
