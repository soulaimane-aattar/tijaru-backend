/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Db } from '../../database';

export type FakeCall = {
  op: 'select' | 'insert' | 'update' | 'delete';
  table: string;
  where: unknown[][];
  values?: unknown;
  set?: unknown;
  conflict?: { columns: unknown; set: unknown };
};

/** Script key `"<op>:<table>"` → rows (array) / one row / `(call) => …`. Unscripted reads yield `[]`. */
type Script = Record<string, unknown>;

/** Stand-in for Kysely's expression builder: callbacks yield plain descriptors that specs can assert on. */
const eb: any = Object.assign((a: unknown, op: string, b: unknown) => ({ a, op, b }), {
  or: (or: unknown[]) => ({ or }),
  and: (and: unknown[]) => ({ and }),
});

/**
 * Recording stand-in for `Db` in unit specs: every builder method chains and is recorded, `execute*`
 * resolves from the script. Assert on `calls` (e.g. the `where` tuples). Callback forms
 * (`where(eb => …)`) are not evaluated — keep repo/guard queries tuple-based where specs need to look inside.
 */
export function fakeDb(script: Script = {}, businessId = 'biz-1') {
  const calls: FakeCall[] = [];
  const run = (c: FakeCall): unknown => {
    const r = script[`${c.op}:${c.table}`];
    return typeof r === 'function' ? (r as (c: FakeCall) => unknown)(c) : r;
  };
  const chain = (op: FakeCall['op'], table: string): any => {
    const call: FakeCall = { op, table, where: [] };
    calls.push(call);
    const p: any = new Proxy(
      {},
      {
        get: (_t, name: string) => {
          if (name === 'then') return undefined;
          if (name === 'execute')
            return async () => {
              const r = run(call);
              return r === undefined ? [] : Array.isArray(r) ? r : [r];
            };
          if (name === 'executeTakeFirst' || name === 'executeTakeFirstOrThrow')
            return async () => {
              const r = run(call);
              const one = Array.isArray(r) ? r[0] : r;
              if (one !== undefined) return one;
              if (op === 'update' || op === 'delete') return { numUpdatedRows: 1n, numDeletedRows: 1n };
              if (name === 'executeTakeFirstOrThrow') throw new Error('no result');
              return undefined;
            };
          return (...a: unknown[]) => {
            if (name === 'where') call.where.push(typeof a[0] === 'function' ? [a[0](eb)] : a);
            if (name === 'values') call.values = a[0];
            if (name === 'set') call.set = typeof a[0] === 'function' ? a[0](eb) : a[0];
            if (name === 'onConflict')
              (a[0] as (oc: unknown) => void)({
                columns: (columns: unknown) => ({ doUpdateSet: (set: unknown) => (call.conflict = { columns, set }) }),
              });
            return p;
          };
        },
      },
    );
    return p;
  };
  const q: any = {
    selectFrom: (t: string) => chain('select', t),
    insertInto: (t: string) => chain('insert', t),
    updateTable: (t: string) => chain('update', t),
    deleteFrom: (t: string) => chain('delete', t),
  };
  const transaction = () => ({ execute: (fn: (q: unknown) => unknown) => fn(q) });
  const db = { q, admin: q, businessId, tx: (fn: (q: unknown) => unknown) => fn(q) } as unknown as Db;
  (q as any).transaction = transaction;
  return { db, calls, q };
}
