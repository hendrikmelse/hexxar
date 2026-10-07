import { useSyncExternalStore } from 'react';
import type { PlayerId, RoomView } from '@hexxar/shared';

const NAME_KEY = 'hexxar.name';

/** What the menu, lobby and results screens need to know. The match itself lives in `GameView`. */
export interface AppState {
  connected: boolean;
  userId: string | null;
  /** The name shown to other players. */
  name: string;
  /** The room you are in, or `null` for the main menu. */
  room: RoomView | null;
  /** Add to `Date.now()` to get the server's clock. */
  clockOffset: number;
  /** The last thing the server refused, for the menu and lobby to show. */
  error: string | null;
  /** The match's winner (a match player id) and your own id in it, for the results screen. */
  winner: PlayerId | null;
  matchPlayerId: PlayerId | null;
  /** Set while looking at a generated map instead of playing. */
  preview: { seed: number; summary: string; error: string | null } | null;
}

function loadName(): string {
  try {
    const saved = localStorage.getItem(NAME_KEY);
    if (saved) return saved;
  } catch {
    // Storage can be unavailable; a fresh guest name is fine.
  }
  return `Guest ${1000 + Math.floor(Math.random() * 9000)}`;
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
    clockOffset: 0,
    error: null,
    winner: null,
    matchPlayerId: null,
    preview: null,
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
