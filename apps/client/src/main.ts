import { hexEquals, hexKey, type Hex, type RoomSettingsPatch } from '@hexxar/shared';
import { Board, playerColor } from './board.js';
import { applyMessage, emptyGame } from './game.js';
import { Hud } from './hud.js';
import { connect, saveToken } from './net.js';
import { PathDraft } from './path.js';
import { appStore, saveName } from './store.js';
import { mountUi } from './ui/mount.js';

/** The match being played. Reset whenever you are back in the menu. */
const game = emptyGame();
const draft = new PathDraft();

const appEl = document.getElementById('app')!;
const hudEl = document.getElementById('hud')!;

/** True while a match is on screen: running, or finished and showing the result. */
const inMatch = (): boolean => {
  const room = appStore.get().room;
  return room !== null && (room.state === 'running' || room.state === 'finished');
};

const canPlay = (): boolean =>
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

/** The board and the match HUD are only shown during a match. */
function updateVisibility(): void {
  appEl.style.display = inMatch() ? 'block' : 'none';
  hudEl.hidden = !inMatch();
}

function render(change: ReturnType<typeof applyMessage>): void {
  if (!change) return;
  if (change.kind === 'all') {
    board.setAll(game);
    introduceStart();
  } else if (change.kind === 'tiles') {
    board.updateTiles(change.tiles, game);
    // The "you are here" effect is for the planning period only.
    if (game.tick > 0) board.stopIntro();
  }
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

/** Where your land is: the tile you start on, shown to you before the first tick. */
function startingHex(): Hex | null {
  const mine = Object.values(game.tiles).filter((tile) => tile.owner === game.playerId);
  return mine[0] ?? null;
}

function introduceStart(): void {
  const start = startingHex();
  if (game.status === 'playing' && game.tick === 0 && start) board.playIntro(start, myColor());
}

/** Forget the match: back in the menu, or in a lobby for the next one. */
function clearMatch(): void {
  Object.assign(game, emptyGame());
  board.stopIntro();
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
const hud = new Hud(hudEl, {
  surrender: () => connection.send({ type: 'surrender' }),
  fit: () => board.fitToBoard(),
  zoom: (factor) => board.zoomBy(factor),
  home() {
    // The tile of yours nearest the middle of your land.
    const mine = Object.values(game.tiles).filter((tile) => tile.owner === game.playerId);
    if (mine.length === 0) return;
    const q = mine.reduce((sum, t) => sum + t.q, 0) / mine.length;
    const r = mine.reduce((sum, t) => sum + t.r, 0) / mine.length;
    const nearest = mine.reduce((best, t) =>
      Math.hypot(t.q - q, t.r - r) < Math.hypot(best.q - q, best.r - r) ? t : best,
    );
    board.focusOn(nearest);
  },
});

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
  voteStart: (vote) => connection.send({ type: 'voteStart', vote }),
  leaveRoom: () => connection.send({ type: 'leaveRoom' }),
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
        });
        if (!room || previous?.id !== room.id) clearMatch();
        if (!room) joinFromUrl();
        return;
      }
      case 'stats':
        appStore.set({ activity: { duel: message.duel, ffa: message.ffa } });
        return;
      case 'rejected':
        if (inMatch()) render(applyMessage(game, message));
        else appStore.set({ error: message.reason, errorSeq: appStore.get().errorSeq + 1 });
        return;
      default:
        render(applyMessage(game, message));
    }
  },
  shouldReconnect: () => true,
});
