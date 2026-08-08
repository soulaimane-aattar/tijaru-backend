import * as bcrypt from 'bcrypt';

import { ConflictError, ForbiddenError, UnauthorizedError } from '../../../common/errors';
import type { AuthRepository, AuthUserView } from '../domain/auth.repository';

import { AuthService } from './auth.service';

const mockRepo = (): jest.Mocked<AuthRepository> =>
  ({
    findUserByEmail: jest.fn(),
    findProfile: jest.fn(),
    emailInUse: jest.fn(),
    recordLogin: jest.fn(),
    findSessionByTokenHash: jest.fn(),
    createSession: jest.fn(),
    revokeSession: jest.fn(),
    revokeSessionByTokenHash: jest.fn(),
    revokeAllSessions: jest.fn(),
    bumpTokenVersion: jest.fn(),
    createBusinessWithOwner: jest.fn(),
  }) as never;

const mockJwt = () => ({ signAsync: jest.fn().mockResolvedValue('tok') }) as never;
const mockPerms = () => ({ effectiveCapsForRole: jest.fn().mockResolvedValue([]) }) as never;
const mockEnv = {
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_TTL: '7d',
  BCRYPT_COST: 10,
} as never;

const makeUser = (overrides: Partial<AuthUserView> = {}): AuthUserView => ({
  id: 'u1',
  businessId: 'b1',
  name: 'Test',
  email: 'test@example.com',
  role: 'owner',
  active: true,
  passwordHash: '',
  tokenVersion: 0,
  overrides: [],
  businessStatus: 'active',
  ...overrides,
});

const meta = { ip: '127.0.0.1', userAgent: 'test', device: 'test' };

describe('AuthService', () => {
  describe('login gate — business status', () => {
    it('throws ForbiddenError when business is pending', async () => {
      const repo = mockRepo();
      const user = makeUser({ businessStatus: 'pending' });
      user.passwordHash = await bcrypt.hash('pass1234', 4);
      repo.findUserByEmail.mockResolvedValue(user);
      const svc = new AuthService(repo, mockJwt(), mockPerms(), mockEnv);
      await expect(svc.login('test@example.com', 'pass1234', meta)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });

    it('throws ForbiddenError when business is rejected', async () => {
      const repo = mockRepo();
      const user = makeUser({ businessStatus: 'rejected' });
      user.passwordHash = await bcrypt.hash('pass1234', 4);
      repo.findUserByEmail.mockResolvedValue(user);
      const svc = new AuthService(repo, mockJwt(), mockPerms(), mockEnv);
      await expect(svc.login('test@example.com', 'pass1234', meta)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });

    it('allows login when business is active', async () => {
      const repo = mockRepo();
      const user = makeUser({ businessStatus: 'active' });
      user.passwordHash = await bcrypt.hash('pass1234', 4);
      repo.findUserByEmail.mockResolvedValue(user);
      repo.createSession.mockResolvedValue(undefined);
      repo.recordLogin.mockResolvedValue(undefined);
      const svc = new AuthService(repo, mockJwt(), mockPerms(), mockEnv);
      const result = await svc.login('test@example.com', 'pass1234', meta);
      expect(result.tokens.accessToken).toBe('tok');
    });
  });

  describe('register', () => {
    it('throws ConflictError when email already in use', async () => {
      const repo = mockRepo();
      repo.emailInUse.mockResolvedValue(true);
      const svc = new AuthService(repo, mockJwt(), mockPerms(), mockEnv);
      await expect(
        svc.register({
          businessName: 'Test Biz',
          ownerName: 'Owner',
          email: 'taken@example.com',
          password: 'pass1234',
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('creates business with pending status and owner user', async () => {
      const repo = mockRepo();
      repo.emailInUse.mockResolvedValue(false);
      repo.createBusinessWithOwner = jest.fn().mockResolvedValue({ businessId: 'b1', userId: 'u1' });
      const svc = new AuthService(repo, mockJwt(), mockPerms(), mockEnv);
      const result = await svc.register({
        businessName: 'New Biz',
        ownerName: 'Owner',
        email: 'new@example.com',
        password: 'pass1234',
      });
      expect(result).toEqual({ status: 'pending' });
      expect(repo.createBusinessWithOwner).toHaveBeenCalledWith(
        expect.objectContaining({
          businessName: 'New Biz',
          status: 'pending',
          ownerName: 'Owner',
          email: 'new@example.com',
        }),
      );
    });
  });
});
