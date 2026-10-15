import { useSyncExternalStore } from 'react';
import type { ChatMessage, PlayerId, RoomView } from '@hexxar/shared';
import { randomName } from './names.js';
import type { TutorialView } from './tutorial/runner.js';

const NAME_KEY = 'hexxar.name';
const CHAT_OPEN_KEY = 'hexxar.chatOpen';

/** What the menu, lobby and results screens need to know. The match itself lives in `GameView`. */
export interface AppState {
  connected: boolean;
  /** Which page of the site is showing (the address's path): the game itself, or `/privacy`. */
  path: string;
  /** The feedback and bug report page is open (over whatever else is on screen). */
  feedbackOpen: boolean;
  userId: string | null;
  /** The name shown to other players. */
  name: string;
  /** The room you are in, or `null` for the main menu. */
  room: RoomView | null;
  /** What the room's chat has said that you may read, oldest first. */
  chat: ChatMessage[];
  /** The chat window is open (rather than shut to a button): the same in the lobby and in the match, and kept by the browser. */
  chatOpen: boolean;
  /** Add to `Date.now()` to get the server's clock. */
  clockOffset: number;
  /** The last thing the server refused, shown as a toast. */
  error: string | null;
  /** Goes up with every refusal, so the same message can pop up again. */
  errorSeq: number;
  /** A match is just starting and the loading bar is up, covering the board while it settles. */
  launching: boolean;
  /** Something worth telling the player that is not a refusal (someone left the match). */
  info: { players?: { name: string; color: number | null }[]; message?: string } | null;
  infoSeq: number;
  /** The match's winner (a match player id) and your own id in it, for the results screen. */
  winner: PlayerId | null;
  matchPlayerId: PlayerId | null;
  /** The winner's color (0xRRGGBB), for the results card. */
  winnerColor: number | null;
  /** You are out of a match that is still going (beaten, or you gave up). */
  eliminated: boolean;
  /** The end-of-match card (defeat, game over or victory) may be shown now. */
  cardReady: boolean;
  /** Out, and watching the rest of the match. */
  spectating: boolean;
  /** How many people are playing each mode, once the server has said. */
  activity: { duel: number; ffa: number } | null;
  /** Set while the tutorial is open: where in it the player is. */
  tutorial: TutorialView | null;
}

function loadName(): string {
  try {
    const saved = localStorage.getItem(NAME_KEY);
    if (saved) return saved;
  } catch {
    // Storage can be unavailable; a fresh random name is fine.
  }
  return randomName();
}

function loadChatOpen(): boolean {
  try {
    return localStorage.getItem(CHAT_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

/** Open or shut the chat window, for good: the browser remembers it. */
export function setChatOpen(open: boolean): void {
  appStore.set({ chatOpen: open });
  try {
    localStorage.setItem(CHAT_OPEN_KEY, open ? '1' : '0');
  } catch {
    // Not remembering it is harmless.
  }
}

export function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Not remembering the name is harmless.
  }
}

class Store {
  private state: AppState = {
    connected: false,
    userId: null,
    name: loadName(),
    room: null,
    chat: [],
    chatOpen: loadChatOpen(),
    clockOffset: 0,
    error: null,
    errorSeq: 0,
    info: null,
    infoSeq: 0,
    launching: false,
    activity: null,
    tutorial: null,
    winner: null,
    matchPlayerId: null,
    winnerColor: null,
    eliminated: false,
    cardReady: false,
    spectating: false,
    feedbackOpen: false,
    path: location.pathname,
  };
  private readonly listeners = new Set<() => void>();

  get = (): AppState => this.state;

  set(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

export const appStore = new Store();

/**
 * Go to another page of the site without reloading it, so a game or lobby you are in stays as it
 * is (and the browser's back button comes back to where you were).
 */
export function navigate(path: string): void {
  // Going to a page puts the feedback page away, so the page asked for is the one that shows.
  if (location.pathname === path) return appStore.set({ feedbackOpen: false });
  history.pushState(null, '', path);
  appStore.set({ path, feedbackOpen: false });
}

window.addEventListener('popstate', () => appStore.set({ path: location.pathname }));

export function useApp(): AppState {
  return useSyncExternalStore(appStore.subscribe, appStore.get);
}
