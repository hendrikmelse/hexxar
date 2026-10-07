import { createSymmetricMatch, hexDistance, hexEquals, hexKey, type Hex } from '@hexxar/shared';
import { Board, playerColor } from './board.js';
import { applyMessage, emptyGame, type GameView } from './game.js';
import { Hud } from './hud.js';
import { connect, saveToken } from './net.js';
import { PathDraft } from './path.js';

const game = emptyGame();
const draft = new PathDraft();
/** Set while looking at a locally generated map instead of the live match. */
let preview: { seed: number } | null = null;

const canPlay = (): boolean =>
  game.status === 'playing' && game.playerId !== null && !game.eliminated.includes(game.playerId);

const myColor = (): number => (game.playerId && playerColor(game, game.playerId)) || 0xffffff;
const tileExists = (hex: Hex): boolean => game.tiles[hexKey(hex)] !== undefined;

/** Where your queued moves will leave an army, so a drag can carry on from there. */
const plannedEnd = (): Hex | null => game.queue.at(-1)?.to ?? null;

function showDraft(): void {
  board.drawPending(draft.path);
  board.setSelection(draft.path[0] ?? null);
}

function render(change: ReturnType<typeof applyMessage>): void {
  if (!change) return;
  if (preview) {
    hud.render(game);
    return;
  }
  if (change.kind === 'all') board.setAll(game);
  else if (change.kind === 'tiles') board.updateTiles(change.tiles, game);
  board.drawQueue(game.queue, myColor());
  if (draft.active && (change.kind === 'all' || !canPlay())) {
    draft.clear();
    showDraft();
  }
  hud.render(game);
}

const board = await Board.create(document.getElementById('app')!, {
  // Drag from a tile you own, or from the end of your queued path, to give orders.
  canStart(hex) {
    if (preview || !canPlay() || !tileExists(hex)) return false;
    const end = plannedEnd();
    return (
      game.tiles[hexKey(hex)]?.owner === game.playerId || (end !== null && hexEquals(end, hex))
    );
  },
  start(hex) {
    draft.begin(hex);
    showDraft();
  },
  move(hex) {
    draft.extendTo(hex, tileExists);
    showDraft();
  },
  end() {
    if (canPlay()) {
      for (const order of draft.moves()) connection.send({ type: 'order', order });
    }
    draft.clear();
    showDraft();
  },
  cancel() {
    draft.clear();
    showDraft();
  },
});
/** Temporary: generate a map locally, with the current match's player count and size. */
function generatePreview(): void {
  const players = Array.from({ length: game.players.length || 2 }, (_, i) => `P${i + 1}`);
  const distances = Object.values(game.tiles).map((t) => hexDistance(t, { q: 0, r: 0 }));
  const radius = distances.length > 0 ? Math.max(...distances) : 6;
  const seed = Math.floor(Math.random() * 2 ** 32);
  const { state, config } = createSymmetricMatch({
    players,
    seed,
    radius,
    config: game.config ?? undefined,
  });
  const view: GameView = {
    ...emptyGame(),
    status: 'playing',
    playerId: players[0] ?? null,
    config,
    players,
    tiles: { ...state.tiles },
  };
  preview = { seed };
  draft.clear();
  showDraft();
  board.setAll(view);
  board.drawQueue([], 0xffffff);
  hud.setPreview(seed);
}

function backToMatch(): void {
  preview = null;
  board.setAll(game);
  board.drawQueue(game.queue, myColor());
  hud.setPreview(null);
}

const hud = new Hud(document.getElementById('hud')!, () => connection.send({ type: 'surrender' }), {
  generateMap: generatePreview,
  backToMatch,
});
hud.render(game);

const url = import.meta.env.VITE_SERVER_URL ?? `ws://${location.hostname}:8080`;
const connection = connect(url, 'guest', {
  onOpen: () => hud.render(game),
  onClose: () => {
    if (game.status !== 'rejected') game.status = 'connecting';
    hud.render(game);
  },
  onMessage: (message) => {
    if (message.type === 'welcome') saveToken(message.token);
    render(applyMessage(game, message));
  },
  // Don't hammer a server that has told us the match is full.
  shouldReconnect: () => game.status !== 'rejected',
});
