import type { RoomSettingsPatch } from '@hexxar/shared';
import { useApp } from '../store.js';
import { Lobby } from './Lobby.js';
import { Menu } from './Menu.js';
import { Preview } from './Preview.js';
import { Results } from './Results.js';

/** Everything the screens can ask the app to do. */
export interface Actions {
  setName(name: string): void;
  quickPlay(): void;
  createRoom(): void;
  joinRoom(code: string): void;
  updateRoom(patch: RoomSettingsPatch): void;
  startGame(): void;
  leaveRoom(): void;
  startPreview(): void;
  newPreview(): void;
  exitPreview(): void;
}

/** Picks the screen: menu, lobby, or (over the board) the results. */
export function App({ actions }: { actions: Actions }) {
  const app = useApp();
  if (app.preview) return <Preview actions={actions} seed={app.preview.seed} />;
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
