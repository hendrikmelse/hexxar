import { z } from 'zod';
import { matchConfigSchema } from './config.js';
import { orderSchema } from './orders.js';
import { TILE_TYPE_IDS } from './tiles.js';

export const tileSchema = z.object({
  q: z.number().int(),
  r: z.number().int(),
  type: z.enum(TILE_TYPE_IDS),
  owner: z.string().nullable(),
  troops: z.number().int().nonnegative(),
  progress: z.number().int().nonnegative(),
});

export const gameStateSchema = z.object({
  tick: z.number().int().nonnegative(),
  players: z.array(z.string()),
  eliminated: z.array(z.string()),
  winner: z.string().nullable(),
  tiles: z.record(z.string(), tileSchema),
});

/** Messages sent from client to server. */
export const clientMessageSchema = z.discriminatedUnion('type', [
  /** First message on every connection. `token` identifies a returning guest. */
  z.object({
    type: z.literal('hello'),
    name: z.string().trim().min(1).max(24),
    token: z.string().max(100).optional(),
  }),
  /** Append an order to your queue. Queues are append-only. */
  z.object({ type: z.literal('order'), order: orderSchema }),
  z.object({ type: z.literal('surrender') }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

/** Messages sent from server to client. */
export const serverMessageSchema = z.discriminatedUnion('type', [
  /** Reply to `hello`. Keep the token to reconnect as the same player. */
  z.object({ type: z.literal('welcome'), token: z.string(), playerId: z.string() }),
  /** Sent while the match is waiting for more players. */
  z.object({
    type: z.literal('waiting'),
    joined: z.number().int(),
    needed: z.number().int(),
  }),
  /** Full view of the match: sent when it starts and when a player (re)joins it. */
  z.object({
    type: z.literal('snapshot'),
    matchId: z.string(),
    config: matchConfigSchema,
    state: gameStateSchema,
    /** The receiving player's queue, oldest first. */
    queue: z.array(orderSchema),
    /** Server timestamp (ms since epoch) of the next tick, or null if the match is over. */
    nextTickAt: z.number().nullable(),
    /** The server's clock when this was sent, so clients can correct for clock skew. */
    serverTime: z.number(),
  }),
  /** One tick resolved. Only tiles that changed are included. */
  z.object({
    type: z.literal('tick'),
    tick: z.number().int().nonnegative(),
    nextTickAt: z.number().nullable(),
    serverTime: z.number(),
    changed: z.array(tileSchema),
    eliminated: z.array(z.string()),
    winner: z.string().nullable(),
    /** How many orders the receiving player still has queued (the oldest were consumed). */
    queueLength: z.number().int().nonnegative(),
  }),
  /** The order was added to your queue. */
  z.object({ type: z.literal('queued'), order: orderSchema }),
  z.object({ type: z.literal('rejected'), reason: z.string() }),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;
