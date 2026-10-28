import { randomInt } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import type { Updateable } from 'kysely';

import { ConflictError, NotFoundError } from '../../common/errors';
import { MailService } from '../../common/mail/mail.service';
import { type Mail, businessApproved, businessRejected } from '../../common/mail/mail.templates';
import { PermissionsResolver } from '../../common/permissions-resolver.service';
import { LocalStorageService } from '../../common/storage/local-storage.service';
import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';
import { Db, type DB } from '../../database';
import { newId } from '../../database/ids';
import type { AppBuiltinrole, AppBusinessstatus, AppSubscriptionplan } from '../../database/types';
import type { RoleId } from '../../domain/permissions';
import { camelRow } from '../row-case';

// Unambiguous alphabet: no O/0, I/1/l to avoid transcription errors when read aloud or copied.
const TEMP_PW_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function generateTempPassword(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += TEMP_PW_ALPHABET[randomInt(TEMP_PW_ALPHABET.length)];
  return out;
}

const IMPERSONATION_TTL = '2h';

@Injectable()
export class PlatformAdminService {
  // Platform admin is cross-tenant by nature (no tenant in scope): everything runs on the owner pool
  // (`db.admin`, bypasses RLS) and filters by explicit ids.
  constructor(
    private readonly db: Db,
    private readonly jwt: JwtService,
    @Inject(ENV_TOKEN) private readonly env: Env,
    private readonly storage: LocalStorageService,
    private readonly permissions: PermissionsResolver,
    private readonly mail: MailService,
  ) {}

  private get q() {
    return this.db.admin;
  }

  /** First (oldest) active-or-not, non-deleted owner per business id, in the Prisma `users: [...]` shape. */
  private async ownersOf(businessIds: string[]): Promise<Map<string, Record<string, unknown>>> {
    const out = new Map<string, Record<string, unknown>>();
    if (businessIds.length === 0) return out;
    const rows = await this.q
      .selectFrom('app_auth.users')
      .select(['id', 'name', 'email', 'phone', 'business_id'])
      .where('business_id', 'in', businessIds)
      .where('role', '=', 'owner')
      .where('deletedAt', 'is', null)
      .orderBy('createdAt', 'asc')
      .execute();
    for (const { business_id, ...o } of rows) if (!out.has(business_id)) out.set(business_id, o);
    return out;
  }

  async listBusinesses(status?: string, plan?: string): Promise<unknown[]> {
    let qb = this.q.selectFrom('app.businesses').selectAll();
    if (status) qb = qb.where('status', '=', status as AppBusinessstatus);
    if (plan) qb = qb.where('plan', '=', plan as AppSubscriptionplan);
    const rows = await qb.orderBy('createdAt', 'desc').execute();
    const owners = await this.ownersOf(rows.map((r) => r.id));
    return rows.map((r) => ({ ...camelRow(r), users: owners.has(r.id) ? [owners.get(r.id)] : [] }));
  }

  /**
   * Cross-business user listing for the platform-admin panel.
   * Search hits both name + email (case-insensitive). Paginated.
   */
  async listUsers(params: {
    search?: string;
    businessId?: string;
    role?: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: unknown[]; total: number; page: number; pageSize: number }> {
    const { search, businessId, role, page, pageSize } = params;
    const filtered = () => {
      let qb = this.q
        .selectFrom('app_auth.users as u')
        .innerJoin('app.businesses as b', 'b.id', 'u.business_id')
        .where('u.deletedAt', 'is', null);
      if (businessId) qb = qb.where('u.business_id', '=', businessId);
      if (role) qb = qb.where('u.role', '=', role as AppBuiltinrole);
      if (search) {
        const like = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
        qb = qb.where((eb) => eb.or([eb('u.name', 'ilike', like), eb('u.email', 'ilike', like)]));
      }
      return qb;
    };
    const [totalRow, rows] = await Promise.all([
      filtered().select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow(),
      filtered()
        .select([
          'u.id',
          'u.name',
          'u.email',
          'u.phone',
          'u.role',
          'u.active',
          'u.lastLogin',
          'u.createdAt',
          'b.id as b_id',
          'b.name as b_name',
          'b.plan as b_plan',
          'b.status as b_status',
        ])
        .orderBy('u.createdAt', 'desc')
        .limit(pageSize)
        .offset((page - 1) * pageSize)
        .execute(),
    ]);
    const items = rows.map(({ b_id, b_name, b_plan, b_status, ...u }) => ({
      ...u,
      business: { id: b_id, name: b_name, plan: b_plan, status: b_status },
    }));
    return { items, total: Number(totalRow.n), page, pageSize };
  }

  /** Append-only console journal. Failures must never break the action itself. */
  private async audit(entry: {
    action: string;
    tone?: 'ok' | 'warn' | 'err';
    targetType?: 'business' | 'user';
    targetId?: string;
    targetName: string;
    detail?: string;
  }): Promise<void> {
    try {
      await this.q
        .insertInto('platform_audit_logs')
        .values({
          id: newId(),
          action: entry.action,
          tone: entry.tone ?? 'ok',
          target_type: entry.targetType ?? 'business',
          target_id: entry.targetId ?? null,
          target_name: entry.targetName,
          detail: entry.detail ?? '',
        })
        .execute();
    } catch {
      // swallow — journal is best-effort
    }
  }

  async listAudit(limit = 20): Promise<unknown[]> {
    const rows = await this.q
      .selectFrom('platform_audit_logs')
      .selectAll()
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute();
    return rows.map(camelRow);
  }

  async listBugReports(params: {
    status?: string;
    type?: string;
    businessId?: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: unknown[]; total: number; page: number; pageSize: number }> {
    const { status, type, businessId, page, pageSize } = params;
    const filtered = () => {
      let qb = this.q.selectFrom('app.bug_reports');
      if (status) qb = qb.where('status', '=', status);
      if (type) qb = qb.where('type', '=', type);
      if (businessId) qb = qb.where('business_id', '=', businessId);
      return qb;
    };
    const [rows, totalRow] = await Promise.all([
      filtered()
        .selectAll()
        .orderBy('created_at', 'desc')
        .limit(pageSize)
        .offset((page - 1) * pageSize)
        .execute(),
      filtered().select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow(),
    ]);
    const userIds = [...new Set(rows.map((r) => r.user_id))];
    const bizIds = [...new Set(rows.map((r) => r.business_id))];
    const [users, businesses] = await Promise.all([
      userIds.length
        ? this.q.selectFrom('app_auth.users').select(['id', 'name', 'email']).where('id', 'in', userIds).execute()
        : [],
      bizIds.length ? this.q.selectFrom('app.businesses').select(['id', 'name']).where('id', 'in', bizIds).execute() : [],
    ]);
    const items = rows.map((r) => ({
      ...camelRow(r),
      user: users.find((u) => u.id === r.user_id) ?? null,
      business: businesses.find((b) => b.id === r.business_id) ?? null,
    }));
    return { items, total: Number(totalRow.n), page, pageSize };
  }

  async updateBugReportStatus(id: string, status: string): Promise<unknown> {
    const updated = await this.q
      .updateTable('app.bug_reports')
      .set({ status })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
    if (!updated) throw new NotFoundError('BugReport', id);
    return camelRow(updated);
  }

  async getBugReportScreenshot(id: string): Promise<{ data: Buffer; mime: string }> {
    const found = await this.q
      .selectFrom('app.bug_reports')
      .select('screenshot')
      .where('id', '=', id)
      .executeTakeFirst();
    if (!found?.screenshot) throw new NotFoundError('BugReport screenshot', id);
    const ext = found.screenshot.split('.').pop();
    const mime = ext === 'jpg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
    return { data: await this.storage.read(found.screenshot), mime };
  }

  /** Full business row or 404. */
  private async biz(id: string) {
    const biz = await this.q.selectFrom('app.businesses').selectAll().where('id', '=', id).executeTakeFirst();
    if (!biz) throw new NotFoundError('Business', id);
    return biz;
  }

  async approveBusiness(id: string): Promise<void> {
    const biz = await this.biz(id);
    if (biz.status !== 'pending') throw new ConflictError('Business is not pending');
    await this.q.updateTable('app.businesses').set({ status: 'active' }).where('id', '=', id).execute();
    await this.audit({ action: 'approve', targetId: id, targetName: biz.name });
    await this.mailOwner(id, biz.name, (who) => businessApproved(who, this.env.APP_URL));
  }

  async rejectBusiness(id: string): Promise<void> {
    const biz = await this.biz(id);
    if (biz.status !== 'pending') throw new ConflictError('Business is not pending');
    await this.q.updateTable('app.businesses').set({ status: 'rejected' }).where('id', '=', id).execute();
    await this.audit({ action: 'reject', tone: 'warn', targetId: id, targetName: biz.name });
    await this.mailOwner(id, biz.name, businessRejected);
  }

  private async mailOwner(
    businessId: string,
    businessName: string,
    build: (who: { ownerName: string; businessName: string }) => Mail,
  ): Promise<void> {
    const owner = await this.q
      .selectFrom('app_auth.users')
      .select(['name', 'email'])
      .where('business_id', '=', businessId)
      .where('role', '=', 'owner')
      .where('deletedAt', 'is', null)
      .orderBy('createdAt', 'asc')
      .executeTakeFirst();
    if (owner) await this.mail.send(owner.email, build({ ownerName: owner.name, businessName }));
  }

  async getBusinessDetail(id: string) {
    const biz = await this.biz(id);
    const [owners, modules] = await Promise.all([
      this.ownersOf([id]),
      this.q.selectFrom('app.business_modules').selectAll().where('business_id', '=', id).execute(),
    ]);
    return {
      ...camelRow(biz),
      users: owners.has(id) ? [owners.get(id)] : [],
      modules: modules.map(camelRow),
    };
  }

  async updateBusiness(
    id: string,
    data: {
      maxUsers?: number | undefined;
      maxProducts?: number | undefined;
      maxWarehouses?: number | undefined;
    },
  ) {
    const biz = await this.biz(id);
    const cleaned = Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== undefined),
    ) as Record<string, number>;
    const col = { maxUsers: 'max_users', maxProducts: 'max_products', maxWarehouses: 'max_warehouses' } as const;
    const set = Object.fromEntries(Object.entries(cleaned).map(([k, v]) => [col[k as keyof typeof col], v]));
    const updated = Object.keys(set).length
      ? await this.q.updateTable('app.businesses').set(set).where('id', '=', id).returningAll().executeTakeFirstOrThrow()
      : biz;
    const before = camelRow(biz);
    const changes = Object.entries(cleaned)
      .map(([k, v]) => `${k} ${String(before[k])} → ${String(v)}`)
      .join(', ');
    if (changes) {
      await this.audit({ action: 'update-limits', targetId: id, targetName: biz.name, detail: changes });
    }
    return camelRow(updated);
  }

  async extendSubscription(id: string, duration: '1mo' | '3mo' | '6mo' | '1yr') {
    const biz = await this.biz(id);

    const durations: Record<'1mo' | '3mo' | '6mo' | '1yr', number> = {
      '1mo': 30,
      '3mo': 90,
      '6mo': 180,
      '1yr': 365,
    };
    const days = durations[duration];
    const start = new Date();
    const end = new Date(start.getTime() + days * 86_400_000);

    const updated = await this.q
      .updateTable('app.businesses')
      .set({ plan: 'active', subscription_start: start, subscription_end: end })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    const months: Record<typeof duration, string> = { '1mo': '+1 mois', '3mo': '+3 mois', '6mo': '+6 mois', '1yr': '+12 mois' };
    await this.audit({ action: 'extend', targetId: id, targetName: biz.name, detail: months[duration] });
    return camelRow(updated);
  }

  async suspendBusiness(id: string): Promise<void> {
    const biz = await this.biz(id);
    await this.q
      .updateTable('app.businesses')
      .set({ status: 'suspended', plan: 'suspended' })
      .where('id', '=', id)
      .execute();
    await this.audit({ action: 'suspend', tone: 'err', targetId: id, targetName: biz.name });
  }

  async activateBusiness(id: string): Promise<void> {
    const biz = await this.biz(id);
    await this.q
      .updateTable('app.businesses')
      .set({ status: 'active', plan: 'active' })
      .where('id', '=', id)
      .execute();
    await this.audit({ action: 'activate', targetId: id, targetName: biz.name });
  }

  async updateModules(id: string, modules: Record<string, boolean>): Promise<void> {
    const biz = await this.biz(id);

    await this.q.transaction().execute(async (trx) => {
      for (const [moduleId, active] of Object.entries(modules)) {
        await trx
          .insertInto('app.business_modules')
          .values({ business_id: id, module_id: moduleId, active, updatedAt: new Date() })
          .onConflict((oc) => oc.columns(['business_id', 'module_id']).doUpdateSet({ active, updatedAt: new Date() }))
          .execute();
      }
    });
    const detail = Object.entries(modules)
      .map(([m, active]) => `${m}: ${active ? 'on' : 'off'}`)
      .join(', ');
    await this.audit({ action: 'update-modules', targetId: id, targetName: biz.name, detail });
  }

  /**
   * Platform-level business settings: multi-stock and TVA.
   * Disabling multi-stock requires at most one active warehouse; the remaining
   * (or newly created) warehouse becomes the default and takes the business name.
   * TVA off ⇒ enabledVatRates [0]; TVA on ⇒ full Moroccan rate set.
   */
  async updateSettings(
    id: string,
    input: {
      multiWarehouse?: boolean | undefined;
      tvaEnabled?: boolean | undefined;
      enabledVatRates?: number[] | undefined;
      defaultVatRate?: number | undefined;
      bonsAffectStock?: boolean | undefined;
    },
  ): Promise<{
    multiWarehouse: boolean;
    enabledVatRates: number[];
    defaultVatRate: number;
    bonsAffectStock: boolean;
  }> {
    const biz = await this.biz(id);
    const setBiz = (set: Updateable<DB['app.businesses']>) =>
      this.q.updateTable('app.businesses').set(set).where('id', '=', id).execute();

    const details: string[] = [];

    if (input.multiWarehouse !== undefined && input.multiWarehouse !== biz.multi_warehouse) {
      if (!input.multiWarehouse) {
        const warehouses = await this.q
          .selectFrom('app.warehouses')
          .select('id')
          .where('business_id', '=', id)
          .where('deletedAt', 'is', null)
          .orderBy('isDefault', 'desc')
          .orderBy('createdAt', 'asc')
          .execute();
        if (warehouses.length > 1) {
          throw new ConflictError(
            `Cannot disable multi-stock: ${warehouses.length} active warehouses exist. Remove extras first.`,
          );
        }
        const main = warehouses[0];
        if (main) {
          await this.q
            .updateTable('app.warehouses')
            .set({ name: biz.name, isDefault: true, active: true })
            .where('id', '=', main.id)
            .execute();
        } else {
          await this.q
            .insertInto('app.warehouses')
            .values({
              id: newId(),
              business_id: id,
              name: biz.name,
              city: biz.city ?? '',
              isDefault: true,
              active: true,
              updatedAt: new Date(),
            })
            .execute();
        }
      }
      await setBiz({ multi_warehouse: input.multiWarehouse });
      details.push(`multi-stock: ${input.multiWarehouse ? 'on' : 'off'}`);
    }

    if (input.tvaEnabled !== undefined) {
      const rates = input.tvaEnabled ? [0, 7, 10, 14, 20] : [0];
      await setBiz({ enabled_vat_rates: rates });
      details.push(`tva: ${input.tvaEnabled ? 'on' : 'off'}`);
    }

    // Fine-grained TVA: exact rate set + default. The default must stay enabled —
    // validated against the FINAL set (request rates override current ones).
    if (input.enabledVatRates !== undefined || input.defaultVatRate !== undefined) {
      const finalRates = input.enabledVatRates ?? biz.enabled_vat_rates;
      const finalDefault = input.defaultVatRate ?? biz.default_vat_rate;
      if (!finalRates.includes(finalDefault)) {
        throw new ConflictError('default_vat_not_enabled');
      }
      await setBiz({ enabled_vat_rates: finalRates, default_vat_rate: finalDefault });
      details.push(
        `tva rates: [${finalRates.join(',')}] default: ${finalDefault}`,
      );
    }

    if (input.bonsAffectStock !== undefined && input.bonsAffectStock !== biz.bons_affect_stock) {
      await setBiz({ bons_affect_stock: input.bonsAffectStock });
      details.push(`bons-affect-stock: ${input.bonsAffectStock ? 'on' : 'off'}`);
    }

    if (details.length) {
      await this.audit({
        action: 'update-settings',
        targetId: id,
        targetName: biz.name,
        detail: details.join(', '),
      });
    }

    const fresh = await this.q
      .selectFrom('app.businesses')
      .select(['multi_warehouse', 'enabled_vat_rates', 'default_vat_rate', 'bons_affect_stock'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    return {
      multiWarehouse: fresh.multi_warehouse,
      enabledVatRates: fresh.enabled_vat_rates,
      defaultVatRate: fresh.default_vat_rate,
      bonsAffectStock: fresh.bons_affect_stock,
    };
  }

  /**
   * Platform-admin control of one business employee's access: change their
   * built-in role and/or activate/deactivate the account. Guards against
   * locking a business out: the last active owner can't be demoted or
   * deactivated.
   */
  async updateBusinessUser(
    businessId: string,
    userId: string,
    input: {
      role?:
        | 'owner'
        | 'admin'
        | 'manager'
        | 'stockkeeper'
        | 'cashier'
        | 'viewer'
        | undefined;
      active?: boolean | undefined;
    },
  ): Promise<{ id: string; name: string; email: string; role: string; active: boolean }> {
    const user = await this.q
      .selectFrom('app_auth.users')
      .select(['id', 'name', 'role', 'active'])
      .where('id', '=', userId)
      .where('business_id', '=', businessId)
      .executeTakeFirst();
    if (!user) throw new NotFoundError('User', userId);

    const losesOwner =
      (input.role !== undefined && user.role === 'owner' && input.role !== 'owner') ||
      (input.active === false && user.role === 'owner' && user.active);
    if (losesOwner) {
      const others = await this.q
        .selectFrom('app_auth.users')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('business_id', '=', businessId)
        .where('role', '=', 'owner')
        .where('active', '=', true)
        .where('id', '<>', userId)
        .where('deletedAt', 'is', null)
        .executeTakeFirstOrThrow();
      if (Number(others.n) === 0) {
        throw new ConflictError('last_owner');
      }
    }

    const set = {
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    };
    const updated = Object.keys(set).length
      ? await this.q
          .updateTable('app_auth.users')
          .set(set)
          .where('id', '=', userId)
          .returning(['id', 'name', 'email', 'role', 'active'])
          .executeTakeFirstOrThrow()
      : await this.q
          .selectFrom('app_auth.users')
          .select(['id', 'name', 'email', 'role', 'active'])
          .where('id', '=', userId)
          .executeTakeFirstOrThrow();

    await this.audit({
      action: 'update-business-user',
      targetId: userId,
      targetName: user.name,
      detail: [
        ...(input.role !== undefined ? [`role: ${input.role}`] : []),
        ...(input.active !== undefined ? [`active: ${input.active}`] : []),
      ].join(', ') || 'no-op',
    });

    return updated;
  }

  /**
   * Admin-initiated password reset: generates a one-time temp password, revokes the user's
   * active sessions, and bumps tokenVersion so the old refresh token is rejected. The plaintext
   * is returned exactly once — only its bcrypt hash is persisted.
   */
  async resetUserPassword(userId: string, customPassword?: string): Promise<{ tempPassword: string }> {
    const user = await this.q
      .selectFrom('app_auth.users as u')
      .innerJoin('app.businesses as b', 'b.id', 'u.business_id')
      .select(['u.id', 'u.business_id', 'u.name', 'b.name as business_name'])
      .where('u.id', '=', userId)
      .where('u.deletedAt', 'is', null)
      .executeTakeFirst();
    if (!user) throw new NotFoundError('User', userId);

    let tempPassword: string;
    if (customPassword && customPassword.length >= 8) {
      tempPassword = customPassword;
    } else {
      const policy = await this.q
        .selectFrom('app_auth.security_policies')
        .select('passwordMinLen')
        .where('businessId', '=', user.business_id)
        .executeTakeFirst();
      const length = Math.max(10, policy?.passwordMinLen ?? 8);
      tempPassword = generateTempPassword(length);
    }
    const passwordHash = await bcrypt.hash(tempPassword, this.env.BCRYPT_COST);

    await this.q
      .updateTable('app_auth.users')
      .set((eb) => ({ passwordHash, tokenVersion: eb('tokenVersion', '+', 1) }))
      .where('id', '=', user.id)
      .execute();
    await this.q
      .updateTable('app_auth.sessions')
      .set({ revokedAt: new Date() })
      .where('userId', '=', user.id)
      .where('revokedAt', 'is', null)
      .execute();

    await this.audit({
      action: 'reset-password',
      tone: 'warn',
      targetType: 'user',
      targetId: user.id,
      targetName: user.name,
      detail: user.business_name ?? '',
    });
    return { tempPassword };
  }

  /**
   * Short-lived business-scoped token for the super admin. Acts as a real user of the
   * business (owner by default, or `userId` for the role switcher) so FK writes stay
   * valid and caps match that role. Every issue is audited.
   */
  async impersonate(
    businessId: string,
    adminId: string,
    userId?: string,
  ): Promise<{ accessToken: string; business: { id: string; name: string }; user: { id: string; name: string; role: string } }> {
    const biz = await this.q
      .selectFrom('app.businesses')
      .select(['id', 'name'])
      .where('id', '=', businessId)
      .executeTakeFirst();
    if (!biz) throw new NotFoundError('Business', businessId);

    let uq = this.q
      .selectFrom('app_auth.users')
      .select(['id', 'name', 'role', 'tokenVersion'])
      .where('business_id', '=', businessId)
      .where('deletedAt', 'is', null)
      .where('active', '=', true);
    uq = userId ? uq.where('id', '=', userId) : uq.where('role', '=', 'owner');
    const user = await uq.orderBy('createdAt', 'asc').limit(1).executeTakeFirst();
    if (!user) throw new NotFoundError('User', userId ?? 'owner');

    const userOverrides = await this.q
      .selectFrom('app_auth.user_overrides')
      .select(['capId', 'granted'])
      .where('userId', '=', user.id)
      .execute();

    const role = user.role as RoleId;
    const overrides = Object.fromEntries(userOverrides.map((o) => [o.capId, o.granted]));
    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        type: 'platform-admin-impersonate',
        pa: adminId,
        bid: businessId,
        role,
        ver: user.tokenVersion,
        caps: await this.permissions.effectiveCapsForRole(role, businessId),
        overrides,
      },
      { secret: this.env.JWT_ACCESS_SECRET, expiresIn: IMPERSONATION_TTL },
    );

    await this.audit({
      action: 'impersonate',
      tone: 'warn',
      targetType: 'user',
      targetId: user.id,
      targetName: user.name,
      detail: `${biz.name} · ${role}`,
    });

    return { accessToken, business: biz, user: { id: user.id, name: user.name, role } };
  }

  async getStats() {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const n = async (qb: { executeTakeFirstOrThrow(): Promise<{ n: string }> }) => Number((await qb.executeTakeFirstOrThrow()).n);
    const biz = () => this.q.selectFrom('app.businesses').select((eb) => eb.fn.countAll<string>().as('n'));
    const usr = () =>
      this.q
        .selectFrom('app_auth.users')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('deletedAt', 'is', null);
    const [total, active, expired, pending, suspended, users, newUsers7d] = await Promise.all([
      n(biz()),
      n(biz().where('plan', '=', 'active')),
      n(biz().where('plan', '=', 'expired')),
      n(biz().where('status', '=', 'pending')),
      n(biz().where('plan', '=', 'suspended')),
      n(usr()),
      n(usr().where('createdAt', '>=', weekAgo)),
    ]);
    return { total, active, expired, pending, suspended, users, newUsers7d };
  }
}
