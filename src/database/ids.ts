import { randomBytes } from 'node:crypto';

/** cuid-shaped text id (`c` + time + random) — matches the DTOs' `z.string().cuid()` like Prisma's cuid() did. */
export const newId = (): string => `c${Date.now().toString(36)}${randomBytes(9).toString('hex')}`;
