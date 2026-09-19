import type { OrderStatus } from '@prisma/client';

import { DomainError, ForbiddenError } from '../../../common/errors';

/**
 * Minimal typed finite state machine, after Vendure's
 * `packages/core/src/common/finite-state-machine/finite-state-machine.ts` and
 * its `OrderProcess` (`config/order/order-process.ts`): the transition table is
 * data, the side effects hang off hooks rather than off the caller.
 */
export type Transitions = Record<OrderStatus, { to: OrderStatus[] }>;

export const ORDER_PROCESS: Transitions = {
  pending: { to: ['confirmed', 'cancelled'] },
  confirmed: { to: ['in_progress', 'cancelled'] },
  in_progress: { to: ['shipped', 'cancelled'] },
  shipped: { to: ['delivered'] },
  delivered: { to: [] },
  cancelled: { to: [] },
};

export type Actor = 'seller' | 'buyer';

/** Transitions a buyer may drive. Everything else belongs to the seller. */
const BUYER_TRANSITIONS: ReadonlySet<string> = new Set(['pending>cancelled']);

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_PROCESS[from].to.includes(to);
}

/** Throws unless `actor` may move an order from `from` to `to`. */
export function assertTransition(from: OrderStatus, to: OrderStatus, actor: Actor): void {
  if (!canTransition(from, to)) {
    throw new DomainError(
      'invalid_transition',
      `Cannot move an order from ${from} to ${to}`,
      422,
    );
  }
  const buyerAllowed = BUYER_TRANSITIONS.has(`${from}>${to}`);
  if (actor === 'buyer' && !buyerAllowed) {
    throw new ForbiddenError(`Buyers cannot move an order from ${from} to ${to}`);
  }
}

/** Next states offered to a given actor — drives the UI's action buttons. */
export function allowedNext(from: OrderStatus, actor: Actor): OrderStatus[] {
  return ORDER_PROCESS[from].to.filter(
    (to) => actor === 'seller' || BUYER_TRANSITIONS.has(`${from}>${to}`),
  );
}
