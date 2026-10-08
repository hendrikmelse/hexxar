import { useEffect, useState } from 'react';
import {
  DEFAULT_GENERATION_PARAMS,
  type GenerationParams,
  type RoomMode,
  type RoomSettingsPatch,
} from '@hexxar/shared';
import { useApp } from '../store.js';
import { Connecting } from './Connecting.js';
import { Lobby } from './Lobby.js';
import { Menu } from './Menu.js';
import { Preview } from './Preview.js';
import { Results } from './Results.js';
import { Starting } from './Starting.js';

/** What kind of map to preview. */
export interface PreviewOptions {
  /** A symmetric board for that many players, or a battle royale. */
  mode: '2' | '3' | '4' | '6' | 'ffa';
  /** Players on a battle royale board. */
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
 * counts (3 and 6 rotate, 4 mirrors). Battle Royale boards have none.
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
  quickPlay(mode: RoomMode): void;
  createRoom(): void;
  joinRoom(code: string): void;
  updateRoom(patch: RoomSettingsPatch): void;
  startGame(): void;
  voteStart(vote: boolean): void;
  leaveRoom(): void;
  startPreview(options: PreviewOptions): void;
  newPreview(options: PreviewOptions): void;
  exitPreview(): void;
}

/** Whatever the server just refused, popping up over the current screen for a few seconds. */
function Toast() {
  const app = useApp();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!app.error) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const id = setTimeout(() => setVisible(false), TOAST_MS);
    return () => clearTimeout(id);
  }, [app.error, app.errorSeq]);
  if (!app.error || !visible) return null;
  // Keyed by the sequence number, so a repeated message pops up again.
  return (
    <div key={app.errorSeq} className="toast" role="alert">
      <ToastText message={app.error} />
    </div>
  );
}

const TOAST_MS = 4000;

/** The message, capitalized, with a game code at the end ("...code ABCDE") set apart in its own style. */
function ToastText({ message }: { message: string }) {
  const text = message.charAt(0).toUpperCase() + message.slice(1);
  const match = /^(.*code )(\S+)$/i.exec(text);
  if (!match) return <>{text}</>;
  return (
    <>
      {match[1]}
      <code className="toast-code">{match[2]}</code>
    </>
  );
}

/** Picks the screen: menu, lobby, or (over the board) the results. */
export function App({ actions }: { actions: Actions }) {
  return (
    <>
      <Screen actions={actions} />
      <Toast />
    </>
  );
}

function Screen({ actions }: { actions: Actions }) {
  const app = useApp();
  if (app.preview) return <Preview actions={actions} preview={app.preview} />;
  if (!app.connected) {
    // Once we have been connected, a dropped connection is a reconnect.
    return <Connecting reconnecting={app.userId !== null} />;
  }
  const room = app.room;
  if (!room) return <Menu actions={actions} />;
  if (room.state === 'lobby') return <Lobby actions={actions} />;
  if (room.state === 'starting') return <Starting />;
  if (room.state === 'finished') return <Results actions={actions} />;
  return null;
}
