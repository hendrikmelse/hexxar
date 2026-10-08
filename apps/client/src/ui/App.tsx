import { useEffect, useState } from 'react';
import type { RoomMode, RoomSettingsPatch } from '@hexxar/shared';
import { useApp } from '../store.js';
import { Connecting } from './Connecting.js';
import { Gate } from './Gate.js';
import { Lobby } from './Lobby.js';
import { Menu } from './Menu.js';
import { Results } from './Results.js';

/** Everything the screens can ask the app to do. */
export interface Actions {
  setName(name: string): void;
  quickPlay(mode: RoomMode): void;
  createRoom(): void;
  joinRoom(code: string): void;
  updateRoom(patch: RoomSettingsPatch): void;
  submitCode(code: string): void;
  startGame(): void;
  voteStart(vote: boolean): void;
  leaveRoom(): void;
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
  if (!app.connected) {
    // Once we have been connected, a dropped connection is a reconnect.
    return <Connecting reconnecting={app.userId !== null} />;
  }
  if (app.denied) return <Gate actions={actions} />;
  // Wait for the server's welcome (or its refusal) before showing the menu.
  if (app.userId === null) return <Connecting reconnecting={false} />;
  const room = app.room;
  if (!room) return <Menu actions={actions} />;
  if (room.state === 'lobby') return <Lobby actions={actions} />;
  if (room.state === 'finished') return <Results actions={actions} />;
  return null;
}
