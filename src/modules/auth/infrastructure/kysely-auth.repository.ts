
import { Injectable } from '@nestjs/common';

import { Db } from '../../../database';
import { newId } from '../../../database/ids';
import type { AppBusinessstatus } from '../../../database/types';
import { DEFAULT_EXPENSE_CATEGORIES } from '../../expense-categories/domain/default-categories';
import { camelRow } from '../../row-case';
import {
  AuthRepository,
  type AuthUserView,
  type BusinessModuleView,
  type BusinessSubscriptionView,
  type CreateBusinessWithOwnerData,
  type CreateBusinessWithOwnerResult,
  type CreateSessionData,
  type SessionView,
  type UserProfileView,
} from '../domain/auth.repository';

const DEFAULT_MODULES = [
  'stock',
  'multi-stock',
  'pos',
  'expenses',
  'purchase-orders',
  'inventory',
  'reports',
  'customers',
  'suppliers',
];

/**
 * Whole repo runs on the owner pool (`db.admin`): login/refresh/register happen before any tenant
 * exists, and the authenticated calls (logout, change-password, me) only touch the caller's own
 * rows, filtered explicitly by user id. They never read what the request transaction wrote.
 */
@Injectable()
export class KyselyAuthRepository extends AuthRepository {
  constructor(private readonly db: Db) {
    super();
  }

  private userWithStatus() {
    return this.db.admin
      .selectFrom('app_auth.users')
      .innerJoin('app.businesses', 'app.businesses.id', 'app_auth.users.business_id')
      .selectAll('app_auth.users')
      .select('app.businesses.status as business_status');
  }

  private async toView(row: { business_status: string } & Record<string, unknown>): Promise<AuthUserView> {
    const { business_status, ...user } = row;
    const overrides = await this.db.admin
      .selectFrom('app_auth.user_overrides')
      .select(['capId', 'granted'])
      .where('userId', '=', user.id as string)
      .execute();
    return { ...camelRow(user), overrides, businessStatus: business_status } as unknown as AuthUserView;
  }

  async findUserByEmail(email: string): Promise<AuthUserView | null> {
    const row = await this.userWithStatus()
      .where('app_auth.users.email', '=', email)
      .where('app_auth.users.deletedAt', 'is', null)
      .executeTakeFirst();
    return row ? this.toView(row) : null;
  }

  async findPlatformAdminByEmail(email: string) {
    const admin = await this.db.admin
      .selectFrom('platform_admins')
      .selectAll()
      .where('email', '=', email)
      .executeTakeFirst();
    return admin ?? null;
  }

  async findProfile(userId: string): Promise<UserProfileView | null> {
    const user = await this.db.admin
      .selectFrom('app_auth.users')
      .select(['id', 'name', 'email', 'phone', 'role', 'active', 'lastLogin'])
      .where('id', '=', userId)
      .executeTakeFirst();
    if (!user) return null;
    const warehouses = await this.db.admin
      .selectFrom('app_auth.user_warehouses')
      .select('warehouseId')
      .where('userId', '=', userId)
      .execute();
    return { ...user, warehouses, warehouseIds: warehouses.map((w) => w.warehouseId) };
  }

  async emailInUseForBusiness(email: string, businessName: string): Promise<boolean> {
    const row = await this.userWithStatus()
      .where('app_auth.users.email', '=', email)
      .where('app_auth.users.deletedAt', 'is', null)
      .where('app.businesses.name', '=', businessName)
      .executeTakeFirst();
    return row !== undefined;
  }

  async recordLogin(userId: string): Promise<void> {
    await this.db.admin
      .updateTable('app_auth.users')
      .set({ lastLogin: new Date() })
      .where('id', '=', userId)
      .execute();
  }

  async findSessionByTokenHash(hash: string): Promise<SessionView | null> {
    const session = await this.db.admin
      .selectFrom('app_auth.sessions')
      .select(['id', 'expiresAt', 'userId'])
      .where('refreshTokenHash', '=', hash)
      .where('revokedAt', 'is', null)
      .executeTakeFirst();
    if (!session) return null;
    const row = await this.userWithStatus().where('app_auth.users.id', '=', session.userId).executeTakeFirst();
    if (!row) return null;
    return { id: session.id, expiresAt: session.expiresAt, user: await this.toView(row) };
  }

  async createSession(data: CreateSessionData): Promise<void> {
    await this.db.admin
      .insertInto('app_auth.sessions')
      .values((eb) => ({
        id: newId(),
        business_id: eb.selectFrom('app_auth.users').select('business_id').where('id', '=', data.userId),
        userId: data.userId,
        refreshTokenHash: data.refreshTokenHash,
        device: data.device,
        userAgent: data.userAgent,
        ip: data.ip,
        expiresAt: data.expiresAt,
      }))
      .execute();
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.db.admin
      .updateTable('app_auth.sessions')
      .set({ revokedAt: new Date() })
      .where('id', '=', sessionId)
      .execute();
  }

  async revokeSessionByTokenHash(userId: string, hash: string): Promise<void> {
    await this.db.admin
      .updateTable('app_auth.sessions')
      .set({ revokedAt: new Date() })
      .where('userId', '=', userId)
      .where('refreshTokenHash', '=', hash)
      .where('revokedAt', 'is', null)
      .execute();
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.db.admin
      .updateTable('app_auth.sessions')
      .set({ revokedAt: new Date() })
      .where('userId', '=', userId)
      .where('revokedAt', 'is', null)
      .execute();
  }

  async bumpTokenVersion(userId: string): Promise<void> {
    await this.db.admin
      .updateTable('app_auth.users')
      .set((eb) => ({ tokenVersion: eb('tokenVersion', '+', 1) }))
      .where('id', '=', userId)
      .execute();
  }

  async createBusinessWithOwner(
    data: CreateBusinessWithOwnerData,
  ): Promise<CreateBusinessWithOwnerResult> {
    return this.db.admin.transaction().execute(async (trx) => {
      const now = new Date();
      const businessId = newId();
      const userId = newId();
      await trx
        .insertInto('app.businesses')
        .values({
          id: businessId,
          name: data.businessName,
          phone: data.phone ?? null,
          status: data.status as AppBusinessstatus,
          updatedAt: now,
        })
        .execute();
      await trx
        .insertInto('app_auth.users')
        .values({
          id: userId,
          business_id: businessId,
          name: data.ownerName,
          email: data.email,
          passwordHash: data.passwordHash,
          role: 'owner',
          phone: data.phone ?? null,
          updatedAt: now,
        })
        .execute();
      await trx
        .insertInto('app.business_modules')
        .values(DEFAULT_MODULES.map((module_id) => ({ business_id: businessId, module_id, active: true, updatedAt: now })))
        .execute();
      await trx
        .insertInto('app.expense_category_defs')
        .values(
          DEFAULT_EXPENSE_CATEGORIES.map((c) => ({
            id: newId(),
            business_id: businessId,
            key: c.key,
            label: c.label,
            tax_rate: c.taxRate,
            sort_order: c.sortOrder,
            updated_at: now,
          })),
        )
        .execute();
      return { businessId, userId };
    });
  }

  async findBusinessById(businessId: string): Promise<BusinessSubscriptionView | null> {
    const b = await this.db.admin
      .selectFrom('app.businesses')
      .select(['plan', 'subscription_end', 'enabled_vat_rates', 'multi_warehouse', 'bons_affect_stock', 'default_vat_rate'])
      .where('id', '=', businessId)
      .executeTakeFirst();
    return b ? (camelRow(b) as unknown as BusinessSubscriptionView) : null;
  }

  async findModuleAccess(userId: string): Promise<string[] | null> {
    const u = await this.db.admin
      .selectFrom('app_auth.users')
      .select(['restrict_modules', 'module_access'])
      .where('id', '=', userId)
      .executeTakeFirst();
    return u?.restrict_modules ? u.module_access : null;
  }

  async findBusinessModules(businessId: string): Promise<BusinessModuleView[]> {
    const rows = await this.db.admin
      .selectFrom('app.business_modules')
      .select(['module_id', 'active'])
      .where('business_id', '=', businessId)
      .execute();
    return rows.map((r) => ({ moduleId: r.module_id, active: r.active }));
  }

  async findUserById(userId: string): Promise<{ id: string; passwordHash: string } | null> {
    const u = await this.db.admin
      .selectFrom('app_auth.users')
      .select(['id', 'passwordHash'])
      .where('id', '=', userId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    return u ?? null;
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.db.admin
      .updateTable('app_auth.users')
      .set({ passwordHash })
      .where('id', '=', userId)
      .execute();
  }
}
