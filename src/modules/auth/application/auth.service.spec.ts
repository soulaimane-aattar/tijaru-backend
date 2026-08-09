import * as bcrypt from 'bcrypt';

import { ConflictError, ForbiddenError, UnauthorizedError } from '../../../common/errors';
import type { AuthRepository, AuthUserView } from '../domain/auth.repository';

import { AuthService } from './auth.service';

const mockRepo = (): jest.Mocked<AuthRepository> =>
  ({
    findUserByEmail: jest.fn(),
    findPlatformAdminByEmail: jest.fn(),
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

  describe('loginPlatformAdmin', () => {
    it('returns platform-admin token when credentials match', async () => {
      const repo = mockRepo();
      const passwordHash = await bcrypt.hash('adminpass1', 4);
      repo.findPlatformAdminByEmail.mockResolvedValue({
        id: 'pa1',
        email: 'admin@tijaru.com',
        name: 'Super Admin',
        passwordHash,
        tokenVersion: 0,
      });
      const svc = new AuthService(repo, mockJwt(), mockPerms(), mockEnv);
      const result = await svc.loginPlatformAdmin('admin@tijaru.com', 'adminpass1');
      expect(result).toEqual({ accessToken: 'tok', type: 'platform-admin' });
    });

    it('returns null when no platform admin matches the email', async () => {
      const repo = mockRepo();
      repo.findPlatformAdminByEmail.mockResolvedValue(null);
      const svc = new AuthService(repo, mockJwt(), mockPerms(), mockEnv);
      const result = await svc.loginPlatformAdmin('unknown@tijaru.com', 'whatever');
      expect(result).toBeNull();
    });

    it('returns null (not throw) when the password is wrong, so caller can fall through', async () => {
      const repo = mockRepo();
      const passwordHash = await bcrypt.hash('adminpass1', 4);
      repo.findPlatformAdminByEmail.mockResolvedValue({
        id: 'pa1',
        email: 'admin@tijaru.com',
        name: 'Super Admin',
        passwordHash,
        tokenVersion: 0,
      });
      const svc = new AuthService(repo, mockJwt(), mockPerms(), mockEnv);
      const result = await svc.loginPlatformAdmin('admin@tijaru.com', 'wrong-password');
      expect(result).toBeNull();
    });
  });

  describe('unified login fallthrough (business user)', () => {
    it('unknown email in both platform-admin and user tables rejects with 401', async () => {
      const repo = mockRepo();
      repo.findPlatformAdminByEmail.mockResolvedValue(null);
      repo.findUserByEmail.mockResolvedValue(null);
      const svc = new AuthService(repo, mockJwt(), mockPerms(), mockEnv);
      await expect(svc.loginPlatformAdmin('nobody@test.com', 'x')).resolves.toBeNull();
      await expect(svc.login('nobody@test.com', 'x', meta)).rejects.toBeInstanceOf(
        UnauthorizedError,
      );
    });

    it('falls through to user login when platform-admin password is wrong', async () => {
      const repo = mockRepo();
      const paHash = await bcrypt.hash('adminpass1', 4);
      repo.findPlatformAdminByEmail.mockResolvedValue({
        id: 'pa1',
        email: 'shared@test.com',
        name: 'Admin',
        passwordHash: paHash,
        tokenVersion: 0,
      });
      const user = makeUser({ email: 'shared@test.com' });
      user.passwordHash = await bcrypt.hash('userpass1', 4);
      repo.findUserByEmail.mockResolvedValue(user);
      repo.createSession.mockResolvedValue(undefined);
      repo.recordLogin.mockResolvedValue(undefined);
      const svc = new AuthService(repo, mockJwt(), mockPerms(), mockEnv);

      const paResult = await svc.loginPlatformAdmin('shared@test.com', 'wrong-password');
      expect(paResult).toBeNull();

      const userResult = await svc.login('shared@test.com', 'userpass1', meta);
      expect(userResult.tokens.accessToken).toBe('tok');
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

    it('throws ConflictError when email belongs to a platform admin', async () => {
      const repo = mockRepo();
      repo.emailInUse.mockResolvedValue(false);
      repo.findPlatformAdminByEmail.mockResolvedValue({
        id: 'pa1',
        email: 'admin@tijaru.com',
        name: 'Super Admin',
        passwordHash: 'hash',
        tokenVersion: 0,
      });
      const svc = new AuthService(repo, mockJwt(), mockPerms(), mockEnv);
      await expect(
        svc.register({
          businessName: 'Test Biz',
          ownerName: 'Owner',
          email: 'admin@tijaru.com',
          password: 'pass1234',
        }),
      ).rejects.toBeInstanceOf(ConflictError);
      expect(repo.createBusinessWithOwner).not.toHaveBeenCalled();
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

  describe('full signup → approve → login flow', () => {
    it('register creates pending business, login blocked, approve unblocks', async () => {
      const repo = mockRepo();
      repo.emailInUse.mockResolvedValue(false);
      repo.createBusinessWithOwner = jest.fn().mockResolvedValue({ businessId: 'b1', userId: 'u1' });
      const svc = new AuthService(repo, mockJwt(), mockPerms(), mockEnv);

      // 1. Register
      const registerResult = await svc.register({
        businessName: 'Test Biz',
        ownerName: 'Owner',
        email: 'owner@test.com',
        password: 'pass1234',
      });
      expect(registerResult.status).toBe('pending');

      // 2. Login should fail (pending)
      const pendingUser = makeUser({ email: 'owner@test.com', businessStatus: 'pending' });
      pendingUser.passwordHash = await bcrypt.hash('pass1234', 4);
      repo.findUserByEmail.mockResolvedValue(pendingUser);
      await expect(svc.login('owner@test.com', 'pass1234', meta)).rejects.toBeInstanceOf(
        ForbiddenError,
      );

      // 3. After approve (business.status → active), login succeeds
      const activeUser = makeUser({ email: 'owner@test.com', businessStatus: 'active' });
      activeUser.passwordHash = pendingUser.passwordHash;
      repo.findUserByEmail.mockResolvedValue(activeUser);
      repo.createSession.mockResolvedValue(undefined);
      repo.recordLogin.mockResolvedValue(undefined);
      const loginResult = await svc.login('owner@test.com', 'pass1234', meta);
      expect(loginResult.tokens.accessToken).toBeTruthy();
    });
  });
});
