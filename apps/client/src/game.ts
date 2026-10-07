import {
  applyTickDiff,
  type MatchConfig,
  type Order,
  type PlayerId,
  type ServerMessage,
  type Tile,
} from '@hexxar/shared';

/** `idle` until a match snapshot arrives. */
export type Status = 'idle' | 'playing' | 'over';

/** Everything the client knows about the match, built up from server messages. */
export interface GameView {
  status: Status;
  /** A short message for the player, such as why an order was refused. */
  notice: string;
  playerId: PlayerId | null;
  config: MatchConfig | null;
  tiles: Record<string, Tile>;
  players: PlayerId[];
  eliminated: PlayerId[];
  winner: PlayerId | null;
  tick: number;
  nextTickAt: number | null;
  /** Add to `Date.now()` to get the server's clock. */
  clockOffset: number;
  /** Your queued orders, oldest first. */
  queue: Order[];
}

export function emptyGame(): GameView {
  return {
    status: 'idle',
    notice: '',
    playerId: null,
    config: null,
    tiles: {},
    players: [],
    eliminated: [],
    winner: null,
    tick: 0,
    nextTickAt: null,
    clockOffset: 0,
    queue: [],
  };
}

/** What a message changed, so the renderer can do the minimum work. */
export type Change =
  { kind: 'all' } | { kind: 'tiles'; tiles: Tile[] } | { kind: 'queue' } | { kind: 'status' };

/** Fold a server message into the view. Returns what changed, or null for nothing. */
export function applyMessage(game: GameView, message: ServerMessage): Change | null {
  switch (message.type) {
    case 'snapshot':
      game.playerId = message.you;
      game.config = message.config;
      game.tiles = { ...message.state.tiles };
      game.players = message.state.players;
      game.eliminated = message.state.eliminated;
      game.winner = message.state.winner;
      game.tick = message.state.tick;
      game.queue = message.queue;
      game.nextTickAt = message.nextTickAt;
      game.clockOffset = message.serverTime - Date.now();
      game.status = message.state.winner === null ? 'playing' : 'over';
      game.notice = '';
      return { kind: 'all' };
    case 'tick': {
      // The diff leaves out progress-only changes; applyTickDiff predicts them.
      const touched = game.config
        ? applyTickDiff(game.tiles, message.changed, game.config)
        : message.changed;
      game.tick = message.tick;
      game.nextTickAt = message.nextTickAt;
      game.clockOffset = message.serverTime - Date.now();
      game.eliminated = message.eliminated;
      game.winner = message.winner;
      game.notice = '';
      if (message.winner !== null) game.status = 'over';
      // Queues are append-only, so what remains is always the newest orders.
      game.queue = message.queueLength === 0 ? [] : game.queue.slice(-message.queueLength);
      return { kind: 'tiles', tiles: touched };
    }
    case 'queued':
      game.queue.push(message.order);
      return { kind: 'queue' };
    case 'rejected':
      game.notice = message.reason;
      return { kind: 'status' };
    default:
      // Lobby messages are handled by the app, not the match view.
      return null;
  }
}
