
import { Injectable } from '@nestjs/common';

import { Db } from '../../../database';
import { newId } from '../../../database/ids';
import type { AppBuiltinrole } from '../../../database/types';
import { camelRow } from '../../row-case';
import {
  UsersRepository,
  type CreateUserData,
  type UpdateUserData,
} from '../domain/users.repository';

const SAFE = [
  'id',
  'name',
  'email',
  'phone',
  'role',
  'active',
  'restrict_modules',
  'module_access',
  'lastLogin',
  'createdAt',
  'updatedAt',
] as const;

@Injectable()
export class KyselyUsersRepository extends UsersRepository {
  constructor(private readonly db: Db) {
    super();
  }

  private live() {
    return this.db.q
      .selectFrom('app_auth.users')
      .where('business_id', '=', this.db.businessId)
      .where('deletedAt', 'is', null);
  }

  /** Safe user rows in the Prisma API shape, each with `warehouses: [{ warehouseId }]`. */
  private async withWarehouses(rows: { id: string }[]): Promise<Record<string, unknown>[]> {
    if (rows.length === 0) return [];
    const links = await this.db.q
      .selectFrom('app_auth.user_warehouses')
      .select(['userId', 'warehouseId'])
      .where('business_id', '=', this.db.businessId)
      .where('userId', 'in', rows.map((r) => r.id))
      .execute();
    return rows.map((r) => ({
      ...camelRow(r),
      warehouses: links.filter((l) => l.userId === r.id).map((l) => ({ warehouseId: l.warehouseId })),
    }));
  }

  private async safeById(id: string): Promise<Record<string, unknown>> {
    const row = await this.db.q
      .selectFrom('app_auth.users')
      .select(SAFE)
      .where('business_id', '=', this.db.businessId)
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    return (await this.withWarehouses([row]))[0]!;
  }

  async findAllSafe(): Promise<unknown> {
    return this.withWarehouses(await this.live().select(SAFE).orderBy('createdAt', 'asc').execute());
  }

  async findDetail(id: string): Promise<unknown | null> {
    const row = await this.live().select(SAFE).where('id', '=', id).executeTakeFirst();
    if (!row) return null;
    const [user] = await this.withWarehouses([row]);
    const overrides = await this.db.q
      .selectFrom('app_auth.user_overrides')
      .selectAll()
      .where('business_id', '=', this.db.businessId)
      .where('userId', '=', id)
      .execute();
    return { ...user, overrides: overrides.map(camelRow) };
  }

  async exists(id: string): Promise<boolean> {
    return (await this.live().select('id').where('id', '=', id).executeTakeFirst()) !== undefined;
  }

  async findRole(id: string): Promise<string | null> {
    const u = await this.live().select('role').where('id', '=', id).executeTakeFirst();
    return u?.role ?? null;
  }

  async activeModuleIds(): Promise<string[]> {
    const rows = await this.db.q
      .selectFrom('app.business_modules')
      .select('module_id')
      .where('business_id', '=', this.db.businessId)
      .where('active', '=', true)
      .execute();
    return rows.map((r) => r.module_id);
  }

  async emailInUse(email: string): Promise<boolean> {
    return (await this.live().select('id').where('email', '=', email).executeTakeFirst()) !== undefined;
  }

  async create(data: CreateUserData): Promise<unknown> {
    const id = newId();
    const businessId = this.db.businessId;
    await this.db.tx(async (q) => {
      await q
        .insertInto('app_auth.users')
        .values({
          id,
          business_id: businessId,
          name: data.name,
          email: data.email,
          phone: data.phone,
          passwordHash: data.passwordHash,
          role: data.role as AppBuiltinrole,
          restrict_modules: data.restrictModules,
          module_access: data.moduleAccess,
          updatedAt: new Date(),
        })
        .execute();
      if (data.warehouseIds.length) {
        await q
          .insertInto('app_auth.user_warehouses')
          .values(data.warehouseIds.map((warehouseId) => ({ business_id: businessId, userId: id, warehouseId })))
          .execute();
      }
    });
    return this.safeById(id);
  }

  async update(id: string, data: UpdateUserData, warehouseIds?: string[]): Promise<unknown> {
    const businessId = this.db.businessId;
    await this.db.tx(async (q) => {
      if (warehouseIds !== undefined) {
        await q
          .deleteFrom('app_auth.user_warehouses')
          .where('business_id', '=', businessId)
          .where('userId', '=', id)
          .execute();
        if (warehouseIds.length) {
          await q
            .insertInto('app_auth.user_warehouses')
            .values(warehouseIds.map((warehouseId) => ({ business_id: businessId, userId: id, warehouseId })))
            .execute();
        }
      }
      const set = {
        name: data.name,
        email: data.email,
        phone: data.phone,
        passwordHash: data.passwordHash,
        role: data.role as AppBuiltinrole | undefined,
        active: data.active,
        restrict_modules: data.restrictModules,
        module_access: data.moduleAccess,
      };
      await q
        .updateTable('app_auth.users')
        .set({ ...Object.fromEntries(Object.entries(set).filter(([, v]) => v !== undefined)), updatedAt: new Date() })
        .where('business_id', '=', businessId)
        .where('id', '=', id)
        .execute();
    });
    return this.safeById(id);
  }

  async softDelete(id: string): Promise<void> {
    await this.db.q
      .updateTable('app_auth.users')
      .set((eb) => ({
        deletedAt: new Date(),
        active: false,
        tokenVersion: eb('tokenVersion', '+', 1),
        updatedAt: new Date(),
      }))
      .where('business_id', '=', this.db.businessId)
      .where('id', '=', id)
      .execute();
  }
}
