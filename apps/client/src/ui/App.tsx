import type { RoomSettingsPatch } from '@hexxar/shared';
import { useApp } from '../store.js';
import { Lobby } from './Lobby.js';
import { Menu } from './Menu.js';
import { Preview } from './Preview.js';
import { Results } from './Results.js';

/** What kind of map to preview. */
export interface PreviewOptions {
  /** A symmetric board for that many players, or a free-for-all. */
  mode: '2' | '3' | '4' | '6' | 'ffa';
  /** Players on a free-for-all board. */
  players: number;
  /** Board radius, or `null` for the recommended size. */
  radius: number | null;
}

export const DEFAULT_PREVIEW: PreviewOptions = { mode: '2', players: 8, radius: null };

/** Everything the screens can ask the app to do. */
export interface Actions {
  setName(name: string): void;
  quickPlay(): void;
  createRoom(): void;
  joinRoom(code: string): void;
  updateRoom(patch: RoomSettingsPatch): void;
  startGame(): void;
  leaveRoom(): void;
  startPreview(options: PreviewOptions): void;
  newPreview(options: PreviewOptions): void;
  exitPreview(): void;
}

/** Picks the screen: menu, lobby, or (over the board) the results. */
export function App({ actions }: { actions: Actions }) {
  const app = useApp();
  if (app.preview) return <Preview actions={actions} preview={app.preview} />;
  if (!app.connected) {
    return (
      <div className="screen">
        <div className="card">
          <p>Connecting…</p>
        </div>
      </div>
    );
  }
  const room = app.room;
  if (!room) return <Menu actions={actions} />;
  if (room.state === 'lobby' || room.state === 'starting') return <Lobby actions={actions} />;
  if (room.state === 'finished') return <Results actions={actions} />;
  return null;
}
