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

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

/**
 * - `duel`: two players on a symmetric board.
 * - `ffa`: a free-for-all on a random board, for anything from `FFA_MIN_PLAYERS` to
 *   `FFA_MAX_PLAYERS` players.
 */
export const ROOM_MODES = ['duel', 'ffa'] as const;
export type RoomMode = (typeof ROOM_MODES)[number];

/** A free-for-all never has more than this many players, in any kind of game. */
export const FFA_MAX_PLAYERS = 12;
/** The fewest players a free-for-all can start with. */
export const FFA_MIN_PLAYERS = 3;

/** How many players a room of this mode holds. */
export const roomCapacity = (mode: RoomMode): number => (mode === 'ffa' ? FFA_MAX_PLAYERS : 2);

/** The fewest players a room of this mode can start with. */
export const roomMinPlayers = (mode: RoomMode): number => (mode === 'ffa' ? FFA_MIN_PLAYERS : 2);

export const MIN_ROOM_RADIUS = 5;
export const MAX_ROOM_RADIUS = 15;

/** What a room's match will be played with. */
export const roomSettingsSchema = z.object({
  mode: z.enum(ROOM_MODES),
  /** The most players the room holds; fixed by the mode. */
  size: z.number().int().min(2).max(FFA_MAX_PLAYERS),
  /** Board radius in hexes, for duels. Free-for-all boards are sized by the number of players. */
  radius: z.number().int().min(MIN_ROOM_RADIUS).max(MAX_ROOM_RADIUS),
  config: matchConfigSchema,
});
export type RoomSettings = z.infer<typeof roomSettingsSchema>;

/**
 * A partial update to room settings. `config` is merged over the current config and the
 * result is validated by the server.
 */
export const roomSettingsPatchSchema = z.object({
  mode: z.enum(ROOM_MODES).optional(),
  radius: z.number().int().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});
export type RoomSettingsPatch = z.infer<typeof roomSettingsPatchSchema>;

/**
 * - `lobby`: gathering players.
 * - `starting`: full, counting down to the start.
 * - `running`: the match is being played.
 * - `finished`: the match is over; players can look at the result and leave.
 */
export const roomStateSchema = z.enum(['lobby', 'starting', 'running', 'finished']);
export type RoomState = z.infer<typeof roomStateSchema>;

export const roomPlayerSchema = z.object({
  /** Stable for the guest's session. Not the same as the in-match player id. */
  userId: z.string(),
  name: z.string(),
  /** False while the player's connection is down. */
  connected: z.boolean(),
  /** The player's id in the match, once it has started. */
  playerId: z.string().nullable(),
});
export type RoomPlayer = z.infer<typeof roomPlayerSchema>;

export const roomViewSchema = z.object({
  /** Never reused, so it can key saved replays. */
  id: z.string(),
  /** Short code for inviting people; only unique among open rooms. */
  code: z.string(),
  visibility: z.enum(['public', 'private']),
  state: roomStateSchema,
  /** User id of the host, who controls a private room's settings and start. */
  host: z.string(),
  settings: roomSettingsSchema,
  players: z.array(roomPlayerSchema),
  /** The fewest players the match can start with. */
  minPlayers: z.number().int(),
  /** Server timestamp (ms since epoch) when a countdown ends, while `starting`. */
  startsAt: z.number().nullable(),
  /**
   * In a public free-for-all with enough players, when the countdown will begin if nobody
   * else joins before then.
   */
  earlyStartAt: z.number().nullable(),
  serverTime: z.number(),
  /** The receiving player's own user id. */
  you: z.string(),
});
export type RoomView = z.infer<typeof roomViewSchema>;

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/** Messages sent from client to server. */
export const clientMessageSchema = z.discriminatedUnion('type', [
  /** First message on every connection. `token` identifies a returning guest. */
  z.object({
    type: z.literal('hello'),
    name: z.string().trim().min(1).max(24),
    token: z.string().max(100).optional(),
  }),
  /** Change the name shown to other players. Not possible once in a room. */
  z.object({ type: z.literal('setName'), name: z.string().trim().min(1).max(24) }),
  /** Join an open public room of this mode, or open one. */
  z.object({ type: z.literal('quickPlay'), mode: z.enum(ROOM_MODES) }),
  /** Open a private room and become its host. */
  z.object({ type: z.literal('createRoom'), settings: roomSettingsPatchSchema.optional() }),
  z.object({ type: z.literal('joinRoom'), code: z.string().trim().min(1).max(12) }),
  /** Host only, while the room is still gathering players. */
  z.object({ type: z.literal('updateRoom'), settings: roomSettingsPatchSchema }),
  /** Host only: start the countdown once there are enough players. */
  z.object({ type: z.literal('startGame') }),
  /** Leave the room. In a running match this is a surrender. */
  z.object({ type: z.literal('leaveRoom') }),
  /** Append an order to your queue. Queues are append-only. */
  z.object({ type: z.literal('order'), order: orderSchema }),
  z.object({ type: z.literal('surrender') }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

/** Messages sent from server to client. */
export const serverMessageSchema = z.discriminatedUnion('type', [
  /** Reply to `hello`. Keep the token to reconnect as the same guest. */
  z.object({ type: z.literal('welcome'), token: z.string(), userId: z.string() }),
  /** Where you are: a room, or `null` for the main menu. Sent whenever it changes. */
  z.object({ type: z.literal('room'), room: roomViewSchema.nullable() }),
  /** Full view of the match: sent when it starts and when a player (re)joins it. */
  z.object({
    type: z.literal('snapshot'),
    matchId: z.string(),
    config: matchConfigSchema,
    state: gameStateSchema,
    /** The receiving player's id in the match. */
    you: z.string().nullable(),
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
