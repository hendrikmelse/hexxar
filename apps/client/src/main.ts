import {
  createFreeForAllMatch,
  createSymmetricMatch,
  hexEquals,
  hexKey,
  lakesOf,
  recommendedRadius,
  type Hex,
  type RoomSettingsPatch,
} from '@hexxar/shared';
import { Board, playerColor } from './board.js';
import { applyMessage, emptyGame, type GameView } from './game.js';
import { Hud } from './hud.js';
import { connect, saveToken } from './net.js';
import { PathDraft } from './path.js';
import { appStore, saveName } from './store.js';
import { effectiveSymmetry, mountUi, type PreviewOptions } from './ui/mount.js';

/** The match being played. Reset whenever you are back in the menu. */
const game = emptyGame();
const draft = new PathDraft();

const appEl = document.getElementById('app')!;
const hudEl = document.getElementById('hud')!;

const previewing = (): boolean => appStore.get().preview !== null;

/** True while a match is on screen: running, or finished and showing the result. */
const inMatch = (): boolean => {
  const room = appStore.get().room;
  return room !== null && (room.state === 'running' || room.state === 'finished');
};

const canPlay = (): boolean =>
  !previewing() &&
  inMatch() &&
  game.status === 'playing' &&
  game.playerId !== null &&
  !game.eliminated.includes(game.playerId);

const myColor = (): number => (game.playerId && playerColor(game, game.playerId)) || 0xffffff;
const tileExists = (hex: Hex): boolean => game.tiles[hexKey(hex)] !== undefined;

/** Where your queued moves will leave an army, so a drag can carry on from there. */
const plannedEnd = (): Hex | null => game.queue.at(-1)?.to ?? null;

function showDraft(): void {
  board.drawPending(draft.path);
  board.setSelection(draft.path[0] ?? null);
}

/** The board and the match HUD are only shown during a match (or a map preview). */
function updateVisibility(): void {
  appEl.style.display = inMatch() || previewing() ? 'block' : 'none';
  hudEl.hidden = !inMatch() || previewing();
}

function render(change: ReturnType<typeof applyMessage>): void {
  if (!change || previewing()) return;
  if (change.kind === 'all') board.setAll(game);
  else if (change.kind === 'tiles') board.updateTiles(change.tiles, game);
  board.drawQueue(game.queue, myColor());
  if (draft.active && (change.kind === 'all' || !canPlay())) {
    draft.clear();
    showDraft();
  }
  hud.render(game);
  if (appStore.get().winner !== game.winner || appStore.get().matchPlayerId !== game.playerId) {
    appStore.set({ winner: game.winner, matchPlayerId: game.playerId });
  }
}

/** Forget the match: back in the menu, or in a lobby for the next one. */
function clearMatch(): void {
  Object.assign(game, emptyGame());
  draft.clear();
  showDraft();
  board.setAll(game);
  board.drawQueue([], 0xffffff);
  hud.render(game);
  appStore.set({ winner: null, matchPlayerId: null });
}

const board = await Board.create(appEl, {
  // Drag from a tile you own, or from the end of your queued path, to give orders.
  canStart(hex) {
    if (!canPlay() || !tileExists(hex)) return false;
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
const hud = new Hud(hudEl, () => connection.send({ type: 'surrender' }));

// -- Map preview (temporary): generate a map locally and show it on the board ----------

function showPreview(options: PreviewOptions): void {
  const freeForAll = options.mode === 'ffa';
  const count = freeForAll ? options.players : Number(options.mode);
  const players = Array.from({ length: count }, (_, i) => `P${i + 1}`);
  // Free-for-all boards are always as small as they can be; only symmetric ones have a size choice.
  const radius = freeForAll
    ? recommendedRadius(count, 'freeForAll', options.params.tilesPerPlayer)
    : (options.radius ?? recommendedRadius(count, 'symmetric'));
  const seed = options.seed ?? Math.floor(Math.random() * 2 ** 32);
  let generated;
  try {
    generated = freeForAll
      ? createFreeForAllMatch({
          players,
          seed,
          radius,
          shape: options.shape,
          params: options.params,
        })
      : createSymmetricMatch({
          players,
          seed,
          radius,
          symmetry: effectiveSymmetry(options) ?? undefined,
          shape: options.shape,
          params: options.params,
        });
  } catch (error) {
    // E.g. a board too small for the players. Keep showing the last map.
    const current = appStore.get().preview;
    appStore.set({
      preview: {
        seed: current?.seed ?? seed,
        summary: current?.summary ?? '',
        error: error instanceof Error ? error.message : 'could not generate that map',
      },
    });
    return;
  }
  const { state, config } = generated;
  const tiles = Object.values(state.tiles);
  const cities = tiles.filter((t) => t.type === 'city').length;
  const villages = tiles.filter((t) => t.type === 'village').length;
  const lakes = lakesOf(tiles);
  const lakeTiles = lakes.reduce((sum, lake) => sum + lake.length, 0);
  const summary = `${tiles.length} tiles · radius ${radius} · ${cities} cities (${count} starting) · ${villages} villages · ${lakes.length} lakes (${lakeTiles} tiles)`;
  const view: GameView = {
    ...emptyGame(),
    status: 'playing',
    playerId: 'P1',
    config,
    players,
    tiles: { ...state.tiles },
  };
  appStore.set({ preview: { seed, summary, error: null } });
  board.setAll(view, true);
  board.drawQueue([], 0xffffff);
  board.drawPending([]);
  board.setSelection(null);
}

function leavePreview(): void {
  appStore.set({ preview: null });
  board.setAll(game);
}

// -- Server connection ----------------------------------------------------------------

/** Tell the server the current name, then do something that needs it. */
function sendName(): void {
  const name = appStore.get().name.trim();
  if (name) connection.send({ type: 'setName', name });
}

mountUi(document.getElementById('ui')!, {
  setName(name) {
    appStore.set({ name });
    saveName(name);
  },
  quickPlay(mode) {
    appStore.set({ error: null });
    sendName();
    connection.send({ type: 'quickPlay', mode });
  },
  createRoom() {
    appStore.set({ error: null });
    sendName();
    connection.send({ type: 'createRoom' });
  },
  joinRoom(code) {
    appStore.set({ error: null });
    sendName();
    connection.send({ type: 'joinRoom', code });
  },
  updateRoom(settings: RoomSettingsPatch) {
    connection.send({ type: 'updateRoom', settings });
  },
  startGame: () => connection.send({ type: 'startGame' }),
  leaveRoom: () => connection.send({ type: 'leaveRoom' }),
  startPreview: showPreview,
  newPreview: showPreview,
  exitPreview: leavePreview,
});

appStore.subscribe(updateVisibility);
updateVisibility();
hud.render(game);

/** An invite link (`/?join=CODE`) joins that game as soon as we are in the menu. */
function joinFromUrl(): void {
  const params = new URLSearchParams(location.search);
  const code = params.get('join');
  if (!code) return;
  history.replaceState(null, '', location.pathname);
  sendName();
  connection.send({ type: 'joinRoom', code });
}

const url = import.meta.env.VITE_SERVER_URL ?? `ws://${location.hostname}:8080`;
const connection = connect(url, appStore.get().name, {
  onOpen: () => appStore.set({ connected: true }),
  onClose: () => appStore.set({ connected: false }),
  onMessage: (message) => {
    switch (message.type) {
      case 'welcome':
        saveToken(message.token);
        appStore.set({ userId: message.userId });
        return;
      case 'room': {
        const previous = appStore.get().room;
        const { room } = message;
        appStore.set({
          room,
          clockOffset: room ? room.serverTime - Date.now() : appStore.get().clockOffset,
          error: null,
        });
        if (!room || previous?.id !== room.id) clearMatch();
        if (!room) joinFromUrl();
        return;
      }
      case 'rejected':
        if (inMatch()) render(applyMessage(game, message));
        else appStore.set({ error: message.reason });
        return;
      default:
        render(applyMessage(game, message));
    }
  },
  shouldReconnect: () => true,
});
