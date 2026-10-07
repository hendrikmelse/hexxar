import { z } from 'zod';
import { hexDistance } from './hex.js';
import { getTile, type GameState, type PlayerId } from './state.js';

const hexSchema = z.object({ q: z.number().int(), r: z.number().int() });

/**
 * Move all but one troop from `from` onto the adjacent tile `to`.
 * More order types (fortify, build, ...) will join this union later.
 */
export const orderSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('move'), from: hexSchema, to: hexSchema }),
]);
export type Order = z.infer<typeof orderSchema>;

/** At most one order per player is resolved each tick. */
export type OrdersByPlayer = Readonly<Record<PlayerId, Order | undefined>>;

/**
 * Check an order against the state it would execute in. Returns a reason when
 * it is invalid, or `null` when it is fine. Invalid orders are dropped silently
 * by the tick; the reason is for logging and client feedback.
 */
export function checkOrder(state: GameState, player: PlayerId, order: Order): string | null {
  if (state.winner !== null) return 'match is over';
  if (state.eliminated.includes(player)) return 'player is eliminated';
  const from = getTile(state, order.from);
  const to = getTile(state, order.to);
  if (!from) return 'source tile does not exist';
  if (!to) return 'target tile does not exist';
  if (from.owner !== player) return 'source tile is not yours';
  if (from.troops < 2) return 'need at least 2 troops to move';
  if (hexDistance(order.from, order.to) !== 1) return 'target is not adjacent';
  return null;
}
