import { useSyncExternalStore } from 'react';
import type { PlayerId, RoomView } from '@hexxar/shared';
import { randomName } from './names.js';
import type { TutorialView } from './tutorial/runner.js';

const NAME_KEY = 'hexxar.name';

/** What the menu, lobby and results screens need to know. The match itself lives in `GameView`. */
export interface AppState {
  connected: boolean;
  /** Set when the server wants a (new) beta access code before letting us in. */
  denied: 'code required' | 'wrong code' | null;
  userId: string | null;
  /** The name shown to other players. */
  name: string;
  /** The room you are in, or `null` for the main menu. */
  room: RoomView | null;
  /** Add to `Date.now()` to get the server's clock. */
  clockOffset: number;
  /** The last thing the server refused, shown as a toast. */
  error: string | null;
  /** Goes up with every refusal, so the same message can pop up again. */
  errorSeq: number;
  /** The match's winner (a match player id) and your own id in it, for the results screen. */
  winner: PlayerId | null;
  matchPlayerId: PlayerId | null;
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
    denied: null,
    userId: null,
    name: loadName(),
    room: null,
    clockOffset: 0,
    error: null,
    errorSeq: 0,
    activity: null,
    tutorial: null,
    winner: null,
    matchPlayerId: null,
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

export function useApp(): AppState {
  return useSyncExternalStore(appStore.subscribe, appStore.get);
}
