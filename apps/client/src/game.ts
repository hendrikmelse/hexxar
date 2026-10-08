import {
  applyTickDiff,
  visionOf,
  type ExecutedMove,
  type MatchConfig,
  type Order,
  type PlayerId,
  type PlayerScore,
  type ServerMessage,
  type Tile,
  type Vision,
} from '@hexxar/shared';

/** `idle` until a match snapshot arrives. */
type Status = 'idle' | 'playing' | 'over';

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
  /** Every player's strength, for the scoreboard. Not hidden by fog. */
  scores: PlayerScore[];
  /** Names for players, when the room does not have them (the tutorial's rivals). */
  names: Record<PlayerId, string>;
}

/**
 * What the player can see of the board: a map from tile key to how much (see `Vision`), where a
 * missing key is a tile hidden by fog. `null` means everything is in view: no fog in this match,
 * or the player is out of it, or it is over. `ownerOf` can hold back tiles an animation has not
 * shown changing hands yet.
 */
export function visionFor(
  game: GameView,
  ownerOf?: ReadonlyMap<string, PlayerId | null>,
): Map<string, Vision> | null {
  const { config, playerId } = game;
  if (!config || config.fog === 'off' || playerId === null) return null;
  if (game.status !== 'playing' || game.eliminated.includes(playerId)) return null;
  return visionOf(game.tiles, playerId, ownerOf);
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
    scores: [],
    names: {},
  };
}

/** What a message changed, so the renderer can do the minimum work. */
export type Change =
  | { kind: 'all' }
  | { kind: 'tiles'; tiles: Tile[]; moves: ExecutedMove[] }
  | { kind: 'queue' }
  | { kind: 'status' };

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
      game.scores = message.scores;
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
      game.scores = message.scores;
      game.winner = message.winner;
      game.notice = '';
      if (message.winner !== null) game.status = 'over';
      // Queues are append-only, so what remains is always the newest orders.
      game.queue = message.queueLength === 0 ? [] : game.queue.slice(-message.queueLength);
      return { kind: 'tiles', tiles: touched, moves: message.moves ?? [] };
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
