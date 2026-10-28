import { ConflictError, ValidationError } from '../../../common/errors';
import type { LedgerPost } from '../domain/stock-ledger.types';

import { StockLedgerService } from './stock-ledger.service';

const PID = 'p1';
const WH = 'wh1';
const WH2 = 'wh2';
const BID = 'biz1';
const UID = 'user1';

type Call = { op: string; table: string; args: Record<string, unknown> };

/**
 * Recording fake of the Kysely builder: every chained method returns the same proxy, builder
 * callbacks (`set(eb => …)`, `onConflict(oc => …)`) are executed with tiny stand-ins so the
 * resulting values can be asserted, and `execute*` resolves from the scripted `existing` / `updated`.
 */
const setup = (
  script: { existing?: { qty: number; avgCost: number } | undefined; updated?: bigint } = {},
) => {
  const calls: Call[] = [];
  const eb = (a: string, op: string, b: unknown) => ({ a, op, b });
  const q = {
    selectFrom: (table: string) => chain('select', table),
    insertInto: (table: string) => chain('insert', table),
    updateTable: (table: string) => chain('update', table),
  };
  function chain(op: string, table: string) {
    const call: Call = { op, table, args: {} };
    calls.push(call);
    const p: unknown = new Proxy(
      {},
      {
        get: (_t, name: string) => {
          if (name === 'executeTakeFirst') {
            return async () =>
              op === 'update' ? { numUpdatedRows: script.updated ?? 1n } : script.existing;
          }
          if (name === 'executeTakeFirstOrThrow')
            return async () => ({ id: 'm1', ...(call.args.values as object) });
          if (name === 'execute') return async () => [];
          return (...a: unknown[]) => {
            if (name === 'values') call.args.values = a[0];
            if (name === 'where') ((call.args.where ??= []) as unknown[]).push(a);
            if (name === 'set')
              call.args.set =
                typeof a[0] === 'function' ? (a[0] as (e: typeof eb) => unknown)(eb) : a[0];
            if (name === 'onConflict') {
              (a[0] as (oc: unknown) => unknown)({
                columns: () => ({
                  doUpdateSet: (f: (e: typeof eb) => unknown) => (call.args.conflict = f(eb)),
                }),
              });
            }
            return p;
          };
        },
      },
    );
    return p;
  }
  const db = { tx: jest.fn(async (fn: (q: unknown) => unknown) => fn(q)) };
  const svc = new StockLedgerService(db as never);
  return { svc, calls, db };
};

const basePost = (over: Partial<LedgerPost> = {}): LedgerPost => ({
  businessId: BID,
  userId: UID,
  type: 'in',
  reason: 'achat',
  lines: [{ productId: PID, warehouseId: WH, delta: 5 }],
  ...over,
});

const find = (calls: Call[], op: string, table: string) =>
  calls.filter((c) => c.op === op && c.table === table);

describe('StockLedgerService.post', () => {
  it('increments stock and emits Movement on type=in, inside db.tx', async () => {
    const { svc, calls, db } = setup({ existing: { qty: 3, avgCost: 2 } });

    const result = await svc.post(basePost());

    expect(db.tx).toHaveBeenCalledTimes(1);
    expect(find(calls, 'select', 'app.stock_levels')).toHaveLength(1);
    const [ins] = find(calls, 'insert', 'app.stock_levels');
    expect(ins!.args.conflict).toMatchObject({ qty: { a: 'app.stock_levels.qty', op: '+', b: 5 } });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      productId: PID,
      warehouseId: WH,
      qty: 5,
      type: 'in',
      businessId: BID,
    });
  });

  it('rejects out when qty < |delta| (conditional update matches 0 rows)', async () => {
    const { svc } = setup({ updated: 0n });
    const post = () =>
      svc.post(
        basePost({
          type: 'out',
          reason: 'vente',
          lines: [{ productId: PID, warehouseId: WH, delta: -2 }],
        }),
      );

    await expect(post()).rejects.toBeInstanceOf(ConflictError);
    await expect(post()).rejects.toMatchObject({
      response: expect.objectContaining({ title: 'insufficient_stock' }),
    });
  });

  it('creates stock row with unitCost as avgCost when missing on positive delta', async () => {
    const { svc, calls } = setup();
    await svc.post(
      basePost({ lines: [{ productId: PID, warehouseId: WH, delta: 4, unitCost: 3 }] }),
    );

    const [ins] = find(calls, 'insert', 'app.stock_levels');
    expect(ins!.args.values).toMatchObject({
      productId: PID,
      warehouseId: WH,
      businessId: BID,
      qty: 4,
      avgCost: 3,
    });
  });

  it('for transfer: decrements source and increments toWarehouseId', async () => {
    const { svc, calls } = setup();
    const result = await svc.post(
      basePost({
        type: 'transfer',
        reason: 'transfert',
        toWarehouseId: WH2,
        lines: [{ productId: PID, warehouseId: WH, delta: -3 }],
      }),
    );

    const [upd] = find(calls, 'update', 'app.stock_levels');
    expect(upd!.args.set).toMatchObject({ qty: { op: '-', b: 3 } });
    const [ins] = find(calls, 'insert', 'app.stock_levels');
    expect(ins!.args.values).toMatchObject({ warehouseId: WH2, qty: 3 });
    expect(result[0]).toMatchObject({ toWarehouseId: WH2 });
  });

  it('updates avgCost using weighted average on positive delta with unitCost', async () => {
    const { svc, calls } = setup({ existing: { qty: 10, avgCost: 5 } });
    await svc.post(
      basePost({ lines: [{ productId: PID, warehouseId: WH, delta: 10, unitCost: 10 }] }),
    );

    const [ins] = find(calls, 'insert', 'app.stock_levels');
    expect(ins!.args.conflict).toMatchObject({ qty: { op: '+', b: 10 }, avgCost: 7.5 });
  });

  it('leaves avgCost untouched on negative delta', async () => {
    const { svc, calls } = setup();
    await svc.post(
      basePost({
        type: 'out',
        reason: 'vente',
        lines: [{ productId: PID, warehouseId: WH, delta: -2 }],
      }),
    );

    expect(find(calls, 'insert', 'app.stock_levels')).toHaveLength(0);
    const [upd] = find(calls, 'update', 'app.stock_levels');
    expect(upd!.args.set).toMatchObject({ qty: { op: '-', b: 2 } });
    expect(upd!.args.where).toContainEqual(['qty', '>=', 2]);
  });

  it('rejects transfer without toWarehouseId', async () => {
    const { svc } = setup();
    const post = () =>
      svc.post(
        basePost({
          type: 'transfer',
          reason: 'transfert',
          lines: [{ productId: PID, warehouseId: WH, delta: -5 }],
        }),
      );

    await expect(post()).rejects.toBeInstanceOf(ValidationError);
    await expect(post()).rejects.toMatchObject({
      response: expect.objectContaining({ title: 'transfer_missing_destination' }),
    });
  });
});
