/**
 * Kysely returns raw DB column names (some `snake_case`, some already camelCase). The API
 * contract is Prisma's camelCase field names, so repos pass rows through `camelRow`.
 */
const camel = (k: string): string => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

export const camelRow = <T extends object>(row: T): Record<string, unknown> =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [camel(k), v]));

/** Drop `undefined` values (optional DTO fields) before handing them to `.set()` / `.values()`. */
export const defined = <T extends object>(o: T): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
