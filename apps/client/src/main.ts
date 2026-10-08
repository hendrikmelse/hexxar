import { hexEquals, hexKey, type Hex, type RoomSettingsPatch } from '@hexxar/shared';
import { Board, playerColor } from './board.js';
import { applyMessage, emptyGame } from './game.js';
import { Hud } from './hud.js';
import { connect, loadToken, saveCode, saveToken } from './net.js';
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
    // Armies set off first, so the tiles they walk onto are held back until they arrive.
    board.playMoves(change.moves, game);
    board.updateTiles(change.tiles, game);
    board.refreshVision(game);
    // The "you are here" effect is for the planning period only.
    if (game.tick > 0 || game.status !== 'playing') board.stopIntro();
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
  board.stopIntro();
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
});

// -- Server connection ----------------------------------------------------------------

/** The name to play under: whatever is typed in the box, or "Guest" if it is empty. */
const playerName = (): string => appStore.get().name.trim() || 'Guest';

/** Tell the server the current name, then do something that needs it. */
function sendName(): void {
  connection.send({ type: 'setName', name: playerName() });
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
  submitCode(code) {
    saveCode(code);
    connection.send({ type: 'hello', name: playerName(), token: loadToken(), code });
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

// In development the server runs on its own port; in production it serves this page too.
const url =
  import.meta.env.VITE_SERVER_URL ??
  (import.meta.env.DEV
    ? `ws://${location.hostname}:8080/ws`
    : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
const connection = connect(url, playerName, {
  onOpen: () => appStore.set({ connected: true }),
  onClose: () => appStore.set({ connected: false, denied: null }),
  onMessage: (message) => {
    switch (message.type) {
      case 'welcome':
        saveToken(message.token);
        appStore.set({ userId: message.userId, denied: null });
        return;
      case 'denied':
        // A saved code that no longer works is forgotten, so it is not tried again.
        if (message.reason === 'wrong code') saveCode(null);
        appStore.set({ denied: message.reason });
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
});
