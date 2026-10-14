import {
  CHAT_HISTORY,
  hexEquals,
  hexKey,
  type ClientMessage,
  parseMatchConfig,
  type Hex,
  type RoomMode,
  type RoomSettingsPatch,
  type RoomView,
} from '@hexxar/shared';
import { playSound, preloadSounds } from './audio/audio.js';
import { Board, playerColor } from './board.js';
import { applyMessage, emptyGame, isWatching } from './game.js';
import { Hud } from './hud.js';
import { connect, loadToken, saveCode, saveToken } from './net.js';
import { PathDraft } from './path.js';
import { isPreview, PREVIEW_PANEL_WIDTH, setPreviewSink } from './preview.js';
import { appStore, saveName } from './store.js';
import { TutorialRunner } from './tutorial/runner.js';
import { mountUi } from './ui/mount.js';

/** The match being played. Reset whenever you are back in the menu. */
const game = emptyGame();
const draft = new PathDraft();

const appEl = document.getElementById('app')!;
const hudEl = document.getElementById('hud')!;

/** True while a match is on screen: running, or finished and showing the result. */
const inMatch = (): boolean => {
  const { room, tutorial } = appStore.get();
  if (tutorial) return true;
  return room !== null && (room.state === 'running' || room.state === 'finished');
};

/** Where messages for the match go: the tutorial's local match, or the server. */
const send = (message: ClientMessage): void => {
  if (appStore.get().tutorial) tutorial.handle(message);
  else connection.send(message);
};

const canPlay = (): boolean =>
  inMatch() &&
  game.status === 'playing' &&
  game.playerId !== null &&
  !game.eliminated.includes(game.playerId);

const myColor = (): number => (game.playerId && playerColor(game, game.playerId)) || 0xffffff;
const tileExists = (hex: Hex): boolean => game.tiles[hexKey(hex)] !== undefined;

function showDraft(): void {
  board.drawPending(draft.path);
  board.setSelection(draft.path[0] ?? null);
}

/** The board and the match HUD are only shown during a match. */
function updateVisibility(): void {
  appEl.style.display = inMatch() || isPreview() ? 'block' : 'none';
  hudEl.hidden = !inMatch();
  hudEl.classList.toggle('tutorial', appStore.get().tutorial !== null);
}

/** Whether the last thing drawn was for a watcher (out of the match, or it is over). */
let wasWatching = false;

/** Your own queue, or (once you are out or it is over) every player's, each in their color. */
function drawQueues(): void {
  const others = Object.entries(game.queues);
  if (!isWatching(game) || others.length === 0) {
    board.drawQueue(game.queue, myColor());
    return;
  }
  board.drawQueues(
    others.map(([player, queue]) => ({ queue, color: playerColor(game, player) ?? 0xffffff })),
  );
}

function render(change: ReturnType<typeof applyMessage>): void {
  if (!change) return;
  if (change.kind === 'all') {
    board.setAll(game);
    introduceStart();
  } else if (change.kind === 'status') {
    // Something you tried was turned down.
    playSound('order.refused');
  } else if (change.kind === 'tiles') {
    // Armies set off first, so the tiles they walk onto are held back until they arrive.
    board.playMoves(change.moves, game);
    board.updateTiles(change.tiles, game);
    board.refreshVision(game);
    // The "you are here" effect is for the planning period only.
    if (game.tick > 0 || game.status !== 'playing') board.stopIntro();
  }
  drawQueues();
  // Becoming a watcher shows every generation ring, not only your own.
  const watching = isWatching(game);
  if (watching && !wasWatching) board.updateTiles(Object.values(game.tiles), game);
  wasWatching = watching;
  if (draft.active && (change.kind === 'all' || !canPlay())) {
    draft.clear();
    showDraft();
  }
  hud.render(game);
  const out =
    game.status === 'playing' && game.playerId !== null && game.eliminated.includes(game.playerId);
  const app = appStore.get();
  // The defeat, game over and victory cards come up a moment after the deciding tile changes.
  const ended = out || game.status === 'over';
  if (ended && !app.cardReady) awaitCard();
  else if (!ended) stopWatchingForCard();
  // Knocked out earlier, and now the whole match is over too.
  if (app.cardReady && game.status === 'over') playResultSound();
  const cardReady = ended && app.cardReady;
  if (
    app.winner !== game.winner ||
    app.matchPlayerId !== game.playerId ||
    app.eliminated !== out ||
    app.cardReady !== cardReady
  ) {
    appStore.set({
      winner: game.winner,
      matchPlayerId: game.playerId,
      eliminated: out,
      cardReady,
      winnerColor: game.winner ? playerColor(game, game.winner) : null,
    });
  }
}

/** Where your land is: the tile you start on, shown to you before the first tick. */
function startingHex(): Hex | null {
  // A spectator has no starting tile.
  if (game.playerId === null) return null;
  const mine = Object.values(game.tiles).filter((tile) => tile.owner === game.playerId);
  return mine[0] ?? null;
}

function introduceStart(): void {
  board.stopIntro();
  const start = startingHex();
  if (game.status === 'playing' && game.tick === 0 && start) board.playIntro(start, myColor());
}

/** Tell a player still in the game that others have just surrendered or been beaten. */
function announceOut(before: readonly string[]): void {
  const { tutorial, room, infoSeq } = appStore.get();
  const me = game.playerId;
  if (tutorial || me === null || game.eliminated.includes(me)) return;
  const players = game.eliminated
    .filter((id) => !before.includes(id) && id !== me)
    .map((id) => ({
      name: room?.players.find((p) => p.playerId === id)?.name ?? game.names[id] ?? id,
      color: playerColor(game, id),
    }));
  if (players.length === 0) return;
  playSound('player.out');
  appStore.set({ info: { players }, infoSeq: infoSeq + 1 });
}

/** How long a quick-play duel shows an empty opponent box before it tells the server it is joining. */
const SEARCH_DELAY_MS = 1200;
/** The join is waiting to be sent. */
let searchTimer: ReturnType<typeof setTimeout> | null = null;
/** The empty lobby is on screen, standing in for a room the server has not told us about yet. */
let placeholderShown = false;

/** Show a duel lobby with nobody across the table at once, before the server has heard of us. */
function showSearching(): void {
  const { userId, name } = appStore.get();
  if (userId === null) return;
  placeholderShown = true;
  const placeholder: RoomView = {
    id: 'searching',
    code: '',
    visibility: 'public',
    state: 'lobby',
    host: userId,
    settings: { mode: 'duel', size: 2, mapSize: 'normal', config: parseMatchConfig({}) },
    players: [{ userId, name, connected: true, playerId: null }],
    minPlayers: 2,
    waitMs: 5000,
    earlyStartAt: null,
    startVotes: 0,
    votesNeeded: 0,
    youVoted: false,
    spectators: [],
    spectating: false,
    canChat: false,
    serverTime: Date.now(),
    you: userId,
  };
  appStore.set({ room: placeholder });
}

/** Take the server's word on which room we are in. */
function applyRoom(room: RoomView | null, previous: RoomView | null): void {
  placeholderShown = false;
  // From the lobby into the match: a loading bar covers the board for a moment first.
  const launching =
    previous?.state === 'lobby' && room?.state === 'running' && !appStore.get().tutorial;
  appStore.set({
    room,
    // Another room, or none, has another chat (the server sends the log when it applies).
    ...(room && previous?.id === room.id ? {} : { chat: [] }),
    clockOffset: room ? room.serverTime - Date.now() : appStore.get().clockOffset,
    launching,
  });
  // Back to a private room after its match: the match is put away for the next one.
  const backToRoom =
    previous?.id === room?.id && previous?.state === 'finished' && room?.state === 'lobby';
  if (!room || previous?.id !== room.id || backToRoom) clearMatch();
  if (room && previous) tellNewHost(room, previous);
  if (!room) joinFromUrl();
}

/** Someone else was host of this private room, and now you are: say how that came about. */
function tellNewHost(room: RoomView, previous: RoomView): void {
  if (room.visibility !== 'private' || previous.id !== room.id) return;
  if (room.host !== room.you || previous.host === room.you) return;
  const old = previous.players.find((player) => player.userId === previous.host);
  const gone = old !== undefined && !room.players.some((player) => player.userId === old.userId);
  const message =
    gone && previous.state === 'lobby' && room.state === 'lobby'
      ? `${old.name} left the game. You are now the host.`
      : 'You are now the host.';
  appStore.set({ info: { message }, infoSeq: appStore.get().infoSeq + 1 });
}

/** Checks every frame or so whether it is time for that card. */
let cardWatch: ReturnType<typeof setInterval> | null = null;

function stopWatchingForCard(): void {
  if (cardWatch) clearInterval(cardWatch);
  cardWatch = null;
}

/** Result sounds already played this match, so each plays once. */
const playedResults = new Set<string>();

function playResult(kind: 'defeat' | 'victory' | 'gameOver'): void {
  if (playedResults.has(kind)) return;
  playedResults.add(kind);
  playSound(`result.${kind}`);
}

/** The sound for the defeat, game over or victory card that is about to come up. */
function playResultSound(): void {
  if (game.status === 'over') {
    playResult(game.winner !== null && game.winner === game.playerId ? 'victory' : 'gameOver');
  } else {
    playResult('defeat');
  }
}

/**
 * The match has ended for this player (beaten, or the whole match is over). Bring up the card the
 * moment the fog has finished lifting (the clouds fading away), whatever armies are still on
 * the move. With no fog there is nothing to wait for. (Never later than a few seconds after the
 * news.)
 */
function awaitCard(): void {
  if (cardWatch) return;
  const started = performance.now();
  cardWatch = setInterval(() => {
    if (board.cloudsFading && performance.now() - started < 6000) return;
    stopWatchingForCard();
    playResultSound();
    appStore.set({ cardReady: true });
    // Checked about every frame, so the card is there the moment the last cloud is gone.
  }, 16);
}

/** Forget the match: back in the menu, or in a lobby for the next one. */
function clearMatch(): void {
  // The map previewer has no match, and its board is not this one to clear.
  if (isPreview()) return;
  stopWatchingForCard();
  playedResults.clear();
  Object.assign(game, emptyGame());
  wasWatching = false;
  board.stopIntro();
  draft.clear();
  showDraft();
  board.setAll(game);
  board.drawQueue([], 0xffffff);
  hud.render(game);
  appStore.set({
    winner: null,
    matchPlayerId: null,
    winnerColor: null,
    eliminated: false,
    cardReady: false,
    spectating: false,
    // News from the match you just left is no use anywhere else.
    info: null,
  });
}

const board = await Board.create(appEl, {
  // Drag from a tile you own, or from any tile your queued orders are heading for (it will be
  // yours by the time the next order runs), to give orders.
  canStart(hex) {
    if (!canPlay() || !tileExists(hex)) return false;
    return (
      game.tiles[hexKey(hex)]?.owner === game.playerId ||
      game.queue.some((order) => hexEquals(order.to, hex))
    );
  },
  start(hex) {
    // Once the player is doing it themselves, the demonstration goes away.
    board.setPointer([]);
    draft.begin(hex);
    showDraft();
  },
  move(hex) {
    const steps = draft.path.length;
    draft.extendTo(hex, tileExists);
    if (draft.path.length > steps) playSound('order.step');
    else if (draft.path.length < steps) playSound('order.back');
    showDraft();
  },
  end() {
    if (canPlay()) {
      const moves = draft.moves();
      for (const order of moves) send({ type: 'order', order });
    }
    draft.clear();
    showDraft();
  },
  cancel() {
    // Escape (or losing the pointer) throws the order away: the same sound as one being refused.
    playSound('order.refused');
    draft.clear();
    showDraft();
  },
});
// The map previewer (/?maps) shows its boards on this board, next to its own panel.
if (isPreview()) {
  appEl.style.display = 'block';
  board.setLeftInset(PREVIEW_PANEL_WIDTH);
  setPreviewSink({
    show(view) {
      board.setAll(view);
      board.fitToBoard();
    },
    overlay: (draw) => board.setOverlay(draw),
  });
}

// Load the sounds in the background once the page has settled, so the first clicks are not late
// and the game itself is not slowed down getting started.
function startSoundPreload(): void {
  const go = (): void => void preloadSounds();
  if ('requestIdleCallback' in window) window.requestIdleCallback(go, { timeout: 4000 });
  else setTimeout(go, 2000);
}
if (document.readyState === 'complete') startSoundPreload();
else window.addEventListener('load', startSoundPreload, { once: true });

// Every button makes a click, unless it says otherwise: `data-sound="none"` for silence, or the id
// of another sound (see audio/sounds.ts). This runs before the button's own handler (the capture
// phase), because the handler can change the very button that was pressed: the tutorial's Next
// button, for one, is disabled again as soon as it has moved on.
document.addEventListener(
  'click',
  (event) => {
    const target = event.target;
    const button = target instanceof Element ? target.closest('button') : null;
    if (!button || button.disabled) return;
    const id = button.dataset.sound ?? 'ui.click';
    if (id !== 'none') playSound(id);
  },
  true,
);

/** What the surrender button says when someone tries it in the tutorial. */
const CHEEKY_SURRENDERS = [
  'Surrendering already? We have not even started.',
  'Nice try. Quitters do not graduate.',
  'There is nobody here to surrender to.',
  'Bold move, giving up on the tutorial.',
  'Your troops would like a word.',
  'Surrender denied. Please try winning instead.',
];

const hud = new Hud(hudEl, {
  // The sound comes with the Defeat or Game over card, like any other way of being out.
  surrender: () => {
    // In the tutorial there is nothing to give up, and no one to say so but the button.
    if (tutorial.active)
      hud.say(CHEEKY_SURRENDERS[Math.floor(Math.random() * CHEEKY_SURRENDERS.length)]!);
    else send({ type: 'surrender' });
  },
  fit: () => board.fitToBoard(),
  zoom: (factor) => board.zoomBy(factor),
});

// -- The tutorial: a match that runs in the browser -----------------------------------

/** How much of the screen's height the tutorial's guide takes up at the bottom. */
const TUTORIAL_CARD_SPACE = 205;

const tutorial = new TutorialRunner({
  game,
  receive: (message) => render(applyMessage(game, message)),
  reset: clearMatch,
  show: (view) => {
    // The guide's card sits along the bottom, so the board is fitted above it.
    board.setBottomInset(view ? TUTORIAL_CARD_SPACE : 0);
    appStore.set({ tutorial: view });
  },
  highlight: (hexes, rings) => board.setHighlights(hexes, rings),
  pointer: (path) => board.setPointer(path),
  settled: () => board.pendingLandings === 0,
  leave: () => undefined,
});

// A handle for poking at the tutorial from the browser's console while developing.
if (import.meta.env.DEV) Object.assign(window, { tutorial });

// -- Server connection ----------------------------------------------------------------

/** The name to play under: whatever is typed in the box, or "Guest" if it is empty. */
const playerName = (): string => appStore.get().name.trim() || 'Guest';

/** Tell the server the current name, then do something that needs it. */
function sendName(): void {
  connection.send({ type: 'setName', name: playerName() });
}

/** Look for a quick game of this mode. */
function startQuickPlay(mode: RoomMode): void {
  appStore.set({ error: null });
  sendName();
  if (mode === 'duel') {
    // The empty lobby first, and only then the join: so the player who was already waiting and
    // the one who just clicked see the same countdown, starting when the join really happens.
    showSearching();
    searchTimer = setTimeout(() => {
      searchTimer = null;
      connection.send({ type: 'quickPlay', mode });
    }, SEARCH_DELAY_MS);
  } else {
    connection.send({ type: 'quickPlay', mode });
  }
}

/** Set when leaving a quick game to play another of this mode: the search starts once the server has let go. */
let playAgainMode: RoomMode | null = null;

mountUi(document.getElementById('ui')!, {
  setName(name) {
    appStore.set({ name });
    saveName(name);
  },
  quickPlay: startQuickPlay,
  playAgain(mode) {
    playAgainMode = mode;
    connection.send({ type: 'leaveRoom' });
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
  leaveRoom: () => {
    if (searchTimer) {
      // Still on the empty lobby, and the server has not heard of us: just go back.
      clearTimeout(searchTimer);
      searchTimer = null;
      placeholderShown = false;
      appStore.set({ room: null });
      return;
    }
    connection.send({ type: 'leaveRoom' });
  },
  returnToRoom: () => connection.send({ type: 'returnToRoom' }),
  sendChat: (text) => connection.send({ type: 'chat', text }),
  becomeSpectator: () => connection.send({ type: 'becomeSpectator' }),
  becomePlayer: () => connection.send({ type: 'becomePlayer' }),
  spectate: () => appStore.set({ spectating: true }),
  launched: () => {
    playSound('match.begin');
    appStore.set({ launching: false });
  },
  startTutorial: () => tutorial.start(0),
  tutorialNext: () => tutorial.next(),
  tutorialBack: () => tutorial.back(),
  tutorialStartClock: () => tutorial.startClock(),
  tutorialReset: () => tutorial.retry(),
  tutorialRetry: () => tutorial.retry(),
  tutorialJump: (lesson) => tutorial.jump(lesson),
  exitTutorial: () => tutorial.exit(),
});

appStore.subscribe(updateVisibility);
appStore.subscribe(() => {
  const { room, tutorial } = appStore.get();
  hud.setSpectators(tutorial ? 0 : (room?.spectators.length ?? 0));
  hud.setRoomCode(!tutorial && room?.visibility === 'private' ? room.code : null);
});
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
  // The numbers are only known while connected: show "..." rather than stale ones.
  onClose: () => appStore.set({ connected: false, denied: null, activity: null }),
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
        // The tutorial has its own match; a lobby update is none of its business.
        if (appStore.get().tutorial) {
          appStore.set({ room });
          return;
        }
        applyRoom(room, previous);
        // Out of the old game: now look for the next one.
        if (room === null && playAgainMode !== null) {
          const mode = playAgainMode;
          playAgainMode = null;
          startQuickPlay(mode);
        }
        return;
      }
      case 'chat': {
        const { chat } = appStore.get();
        appStore.set({
          chat: message.replace
            ? message.messages
            : [...chat, ...message.messages].slice(-CHAT_HISTORY),
        });
        return;
      }
      case 'stats':
        appStore.set({ activity: { duel: message.duel, ffa: message.ffa } });
        return;
      case 'rejected':
        if (inMatch()) render(applyMessage(game, message));
        else {
          if (placeholderShown) {
            // The server said no to the search: back to the menu.
            placeholderShown = false;
            appStore.set({ room: null });
          }
          appStore.set({ error: message.reason, errorSeq: appStore.get().errorSeq + 1 });
        }
        return;
      default: {
        // Players drop out on a tick, or (when someone surrenders) in a fresh snapshot. A snapshot
        // that starts a match has nothing before it to compare with.
        const before =
          message.type === 'tick' || (message.type === 'snapshot' && game.players.length > 0)
            ? [...game.eliminated]
            : null;
        render(applyMessage(game, message));
        if (before) announceOut(before);
      }
    }
  },
});
