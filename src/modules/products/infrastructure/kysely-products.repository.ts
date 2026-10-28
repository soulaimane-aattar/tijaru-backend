import { Injectable } from '@nestjs/common';
import type { Expression, ExpressionBuilder, SqlBool } from 'kysely';

import { Db } from '../../../database';
import { newId } from '../../../database/ids';
import type { DB } from '../../../database/types';
import {
  ProductsRepository,
  type ActivityLog,
  type CreateProductData,
  type ProductIdentity,
  type ProductSearchCriteria,
  type ProductStockView,
  type UpdateProductData,
} from '../domain/products.repository';

type Eb = ExpressionBuilder<DB & { p: DB['app.products'] }, 'p'>;

const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&');

const SORT_COL = {
  name: 'p.name',
  createdAt: 'p.createdAt',
  updatedAt: 'p.updatedAt',
  sale: 'p.sale',
} as const;

/** API shape: camelCase product columns (the schema mixes camel and snake case). */
const PRODUCT_COLS = [
  'p.id',
  'p.business_id as businessId',
  'p.name',
  'p.name_fr as nameFr',
  'p.barcode',
  'p.sku',
  'p.categoryId',
  'p.purchase',
  'p.sale',
  'p.vat',
  'p.unit',
  'p.supplierId',
  'p.trackExpiry',
  'p.expiry',
  'p.batch',
  'p.minStock',
  'p.maxStock',
  'p.notes',
  'p.tone',
  'p.image_path as imagePath',
  'p.deletedAt',
  'p.createdAt',
  'p.updatedAt',
] as const;

/** Strip keys whose value is `undefined`. */
const compact = <T extends Record<string, unknown>>(obj: T): Record<string, unknown> =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

/** camelCase port data → table columns (undefined dropped). */
const toCols = (d: UpdateProductData): Record<string, unknown> =>
  compact({
    name: d.name,
    name_fr: d.nameFr,
    barcode: d.barcode,
    sku: d.sku,
    categoryId: d.categoryId,
    purchase: d.purchase,
    sale: d.sale,
    vat: d.vat,
    unit: d.unit,
    supplierId: d.supplierId,
    trackExpiry: d.trackExpiry,
    expiry: d.expiry,
    batch: d.batch,
    minStock: d.minStock,
    maxStock: d.maxStock,
    notes: d.notes,
    tone: d.tone,
  });

@Injectable()
export class KyselyProductsRepository extends ProductsRepository {
  constructor(private readonly db: Db) {
    super();
  }

  private products() {
    return this.db.q
      .selectFrom('app.products as p')
      .where('p.business_id', '=', this.db.businessId)
      .where('p.deletedAt', 'is', null);
  }

  private matching(eb: Eb, c: ProductSearchCriteria): Expression<SqlBool>[] {
    const conds: Expression<SqlBool>[] = [];
    if (c.search) {
      const ci = `%${escapeLike(c.search)}%`;
      conds.push(
        eb.or([eb('p.name', 'ilike', ci), eb('p.sku', 'ilike', ci), eb('p.barcode', 'like', ci)]),
      );
    }
    if (c.categoryId) conds.push(eb('p.categoryId', '=', c.categoryId));
    if (c.supplierId) conds.push(eb('p.supplierId', '=', c.supplierId));
    if (c.expiringBefore) {
      conds.push(
        eb('p.trackExpiry', '=', true),
        eb('p.expiry', '<=', c.expiringBefore),
        eb('p.expiry', '>=', new Date()),
      );
    }
    return conds;
  }

  /** Stock levels per product id (optionally with warehouse info), grouped. */
  private async stockLevelsFor(ids: string[], withWarehouse: boolean) {
    const out = new Map<string, Record<string, unknown>[]>();
    if (ids.length === 0) return out;
    const rows = await this.db.q
      .selectFrom('app.stock_levels as s')
      .leftJoin('app.warehouses as w', 'w.id', 's.warehouseId')
      .select([
        's.productId',
        's.warehouseId',
        's.businessId',
        's.qty',
        's.reservedQty',
        's.avgCost',
        's.updatedAt',
        'w.name as wName',
        'w.city as wCity',
      ])
      .where('s.businessId', '=', this.db.businessId)
      .where('s.productId', 'in', ids)
      .execute();
    for (const { wName, wCity, ...s } of rows) {
      const level: Record<string, unknown> = withWarehouse
        ? { ...s, warehouse: { id: s.warehouseId, name: wName, city: wCity } }
        : s;
      const list = out.get(s.productId) ?? [];
      list.push(level);
      out.set(s.productId, list);
    }
    return out;
  }

  private async categories(ids: string[], full: boolean) {
    const m = new Map<string, Record<string, unknown>>();
    if (ids.length === 0) return m;
    const rows = await this.db.q
      .selectFrom('app.categories')
      .select(['id', 'name', 'tone', 'icon', 'active', 'business_id as businessId'])
      .where('business_id', '=', this.db.businessId)
      .where('id', 'in', ids)
      .execute();
    for (const { id, name, tone, icon, ...rest } of rows) {
      m.set(id, full ? { id, name, tone, icon, ...rest } : { id, name, tone, icon });
    }
    return m;
  }

  private async suppliers(ids: string[], full: boolean) {
    const m = new Map<string, Record<string, unknown>>();
    if (ids.length === 0) return m;
    const rows = await this.db.q
      .selectFrom('app.suppliers')
      .select([
        'id',
        'name',
        'contact',
        'phone',
        'email',
        'city',
        'ice',
        'business_id as businessId',
        'createdAt',
        'updatedAt',
      ])
      .where('business_id', '=', this.db.businessId)
      .where('id', 'in', ids)
      .execute();
    for (const r of rows) m.set(r.id, full ? r : { id: r.id, name: r.name });
    return m;
  }

  /** Hydrate Prisma-style relations (stockLevels, category, supplier) onto product rows. */
  private async withRelations<
    T extends { id: string; categoryId: string; supplierId: string | null },
  >(rows: T[], opts: { detail: boolean }) {
    const [levels, cats, sups] = await Promise.all([
      this.stockLevelsFor(
        rows.map((r) => r.id),
        opts.detail,
      ),
      this.categories([...new Set(rows.map((r) => r.categoryId))], opts.detail),
      this.suppliers(
        [...new Set(rows.flatMap((r) => (r.supplierId ? [r.supplierId] : [])))],
        opts.detail,
      ),
    ]);
    return rows.map((r) => ({
      ...r,
      stockLevels: levels.get(r.id) ?? [],
      category: cats.get(r.categoryId) ?? null,
      supplier: r.supplierId ? (sups.get(r.supplierId) ?? null) : null,
    }));
  }

  async findAllMatching(
    criteria: ProductSearchCriteria,
  ): Promise<{ items: (ProductStockView & ProductIdentity)[]; total: number }> {
    const col = SORT_COL[criteria.sort as keyof typeof SORT_COL] ?? 'p.name';
    const [rows, count] = await Promise.all([
      this.products()
        .where((eb) => eb.and(this.matching(eb as Eb, criteria)))
        .select(PRODUCT_COLS)
        .orderBy(col, criteria.order)
        .execute(),
      this.products()
        .where((eb) => eb.and(this.matching(eb as Eb, criteria)))
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .executeTakeFirstOrThrow(),
    ]);
    const items = await this.withRelations(rows, { detail: false });
    return {
      items: items as unknown as (ProductStockView & ProductIdentity)[],
      total: Number(count.n),
    };
  }

  private async detailBy(col: 'p.id' | 'p.barcode', val: string): Promise<unknown | null> {
    const row = await this.products().where(col, '=', val).select(PRODUCT_COLS).executeTakeFirst();
    if (!row) return null;
    return (await this.withRelations([row], { detail: true }))[0];
  }

  findDetail(id: string): Promise<unknown | null> {
    return this.detailBy('p.id', id);
  }

  findByBarcode(code: string): Promise<unknown | null> {
    return this.detailBy('p.barcode', code);
  }

  async findIdentity(id: string): Promise<ProductIdentity | null> {
    const r = await this.products()
      .where('p.id', '=', id)
      .select(['p.id', 'p.name', 'p.sku', 'p.barcode'])
      .executeTakeFirst();
    return r ?? null;
  }

  async hasBarcodeOrSkuConflict(
    barcode: string | undefined,
    sku: string | undefined,
    excludeId?: string,
  ): Promise<boolean> {
    if (!barcode && !sku) return false;
    let q = this.products()
      .select('p.id')
      .where((eb) =>
        eb.or([
          ...(barcode ? [eb('p.barcode', '=', barcode)] : []),
          ...(sku ? [eb('p.sku', '=', sku)] : []),
        ]),
      );
    if (excludeId) q = q.where('p.id', '<>', excludeId);
    return (await q.executeTakeFirst()) !== undefined;
  }

  async create(data: CreateProductData): Promise<unknown> {
    const { stock, ...rest } = data;
    const businessId = this.db.businessId;
    const id = await this.db.tx(async (q) => {
      const p = await q
        .insertInto('app.products')
        .values({
          ...toCols(rest),
          id: newId(),
          business_id: businessId,
          updatedAt: new Date(),
        } as never)
        .returning('id')
        .executeTakeFirstOrThrow();
      if (stock.length > 0) {
        await q
          .insertInto('app.stock_levels')
          .values(
            stock.map((s) => ({
              productId: p.id,
              warehouseId: s.warehouseId,
              businessId,
              qty: s.qty,
              updatedAt: new Date(),
            })),
          )
          .execute();
      }
      return p.id;
    });
    return this.withStockLevels(id);
  }

  /** Product row + raw stockLevels (what Prisma's `include: { stockLevels: true }` returned). */
  private async withStockLevels(id: string): Promise<unknown> {
    const row = await this.db.q
      .selectFrom('app.products as p')
      .where('p.business_id', '=', this.db.businessId)
      .where('p.id', '=', id)
      .select(PRODUCT_COLS)
      .executeTakeFirstOrThrow();
    return { ...row, stockLevels: (await this.stockLevelsFor([id], false)).get(id) ?? [] };
  }

  async update(id: string, data: UpdateProductData): Promise<unknown> {
    const r = await this.db.q
      .updateTable('app.products')
      .set({ ...toCols(data), updatedAt: new Date() } as never)
      .where('business_id', '=', this.db.businessId)
      .where('id', '=', id)
      .executeTakeFirst();
    if (Number(r.numUpdatedRows) === 0) throw new Error(`Product ${id} not found`);
    return this.withStockLevels(id);
  }

  async softDelete(id: string): Promise<void> {
    await this.db.q
      .updateTable('app.products')
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where('business_id', '=', this.db.businessId)
      .where('id', '=', id)
      .execute();
  }

  async warehouseExists(id: string): Promise<boolean> {
    const w = await this.db.q
      .selectFrom('app.warehouses')
      .select('id')
      .where('business_id', '=', this.db.businessId)
      .where('deletedAt', 'is', null)
      .where('id', '=', id)
      .executeTakeFirst();
    return w !== undefined;
  }

  async logActivity(activity: ActivityLog): Promise<void> {
    await this.db.q
      .insertInto('app.activities')
      .values({
        id: newId(),
        business_id: this.db.businessId,
        userId: activity.userId,
        action: activity.action,
        desc: activity.desc,
        device: activity.device ?? null,
      })
      .execute();
  }

  async findImagePath(id: string): Promise<string | null> {
    const r = await this.products()
      .where('p.id', '=', id)
      .select('p.image_path')
      .executeTakeFirst();
    return r?.image_path ?? null;
  }

  private setImage(id: string, path: string | null) {
    return this.db.q
      .updateTable('app.products')
      .set({ image_path: path, updatedAt: new Date() })
      .where('business_id', '=', this.db.businessId)
      .where('id', '=', id)
      .execute();
  }

  async setImagePath(id: string, path: string): Promise<string | null> {
    const prev = await this.findImagePath(id);
    await this.setImage(id, path);
    return prev;
  }

  async clearImagePath(id: string): Promise<string | null> {
    const prev = await this.findImagePath(id);
    if (!prev) return null;
    await this.setImage(id, null);
    return prev;
  }

  async duplicateFrom(
    sourceId: string,
    identity: { name: string; sku: string; barcode: string },
  ): Promise<unknown> {
    const src = await this.db.q
      .selectFrom('app.products as p')
      .where('p.business_id', '=', this.db.businessId)
      .where('p.id', '=', sourceId)
      .select(PRODUCT_COLS)
      .executeTakeFirstOrThrow();
    const r = await this.db.q
      .insertInto('app.products')
      .values({
        id: newId(),
        business_id: this.db.businessId,
        name: identity.name,
        barcode: identity.barcode,
        sku: identity.sku,
        categoryId: src.categoryId,
        purchase: src.purchase,
        sale: src.sale,
        vat: src.vat,
        unit: src.unit,
        supplierId: src.supplierId,
        trackExpiry: src.trackExpiry,
        expiry: src.expiry,
        batch: src.batch,
        minStock: src.minStock,
        maxStock: src.maxStock,
        notes: src.notes,
        tone: src.tone,
        updatedAt: new Date(),
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const { stockLevels: _ignored, ...row } = (await this.withStockLevels(r.id)) as {
      stockLevels: unknown;
    };
    void _ignored;
    return row;
  }
}
