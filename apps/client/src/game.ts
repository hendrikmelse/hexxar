import type { MatchConfig, Order, PlayerId, ServerMessage, Tile } from '@hexxar/shared';

export type Status = 'connecting' | 'waiting' | 'playing' | 'over' | 'rejected';

/** Everything the client knows about the match, built up from server messages. */
export interface GameView {
  status: Status;
  /** Waiting-room or rejection text. */
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
    status: 'connecting',
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
    case 'welcome':
      game.playerId = message.playerId;
      return { kind: 'status' };
    case 'waiting':
      game.status = 'waiting';
      game.notice = `Waiting for players (${message.joined}/${message.needed})`;
      return { kind: 'status' };
    case 'snapshot':
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
      for (const tile of message.changed) game.tiles[`${tile.q},${tile.r}`] = tile;
      game.tick = message.tick;
      game.nextTickAt = message.nextTickAt;
      game.clockOffset = message.serverTime - Date.now();
      game.eliminated = message.eliminated;
      game.winner = message.winner;
      game.notice = '';
      if (message.winner !== null) game.status = 'over';
      // Queues are append-only, so what remains is always the newest orders.
      game.queue = message.queueLength === 0 ? [] : game.queue.slice(-message.queueLength);
      return { kind: 'tiles', tiles: message.changed };
    }
    case 'queued':
      game.queue.push(message.order);
      return { kind: 'queue' };
    case 'rejected':
      game.notice = message.reason;
      if (game.status === 'connecting') game.status = 'rejected';
      return { kind: 'status' };
  }
}
