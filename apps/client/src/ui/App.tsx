import {
  DEFAULT_GENERATION_PARAMS,
  type GenerationParams,
  type RoomSettingsPatch,
} from '@hexxar/shared';
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
  /** Only used for 2 players, where either kind of symmetry works. */
  symmetry: 'mirror' | 'rotational';
  /** The outline of the board. */
  shape: 'random' | 'hexagon';
  /** The generation settings. */
  params: GenerationParams;
  /** Fixed seed, or `null` for a fresh random one. */
  seed: number | null;
}

export const DEFAULT_PREVIEW: PreviewOptions = {
  mode: '2',
  players: 8,
  radius: null,
  symmetry: 'mirror',
  shape: 'random',
  params: DEFAULT_GENERATION_PARAMS,
  seed: null,
};

/**
 * The symmetry a symmetric board will use: a choice for 2 players, but fixed for the other
 * counts (3 and 6 rotate, 4 mirrors). Free-for-all boards have none.
 */
export function effectiveSymmetry(options: PreviewOptions): 'mirror' | 'rotational' | null {
  switch (options.mode) {
    case '2':
      return options.symmetry;
    case '3':
    case '6':
      return 'rotational';
    case '4':
      return 'mirror';
    default:
      return null;
  }
}

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
