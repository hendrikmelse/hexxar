import { useEffect, useState, type ReactNode } from 'react';
import { playSound } from '../audio/audio.js';
import type { RoomMode, RoomSettingsPatch } from '@hexxar/shared';
import { useApp } from '../store.js';
import { Connecting } from './Connecting.js';
import { Gate } from './Gate.js';
import { Loading } from './Loading.js';
import { Lobby } from './Lobby.js';
import { Menu } from './Menu.js';
import { Out } from './Out.js';
import { Results } from './Results.js';
import { SoundToggle } from './SoundToggle.js';
import { SoundPage } from './SoundPage.js';
import { Tutorial } from './Tutorial.js';

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
  spectate(): void;
  launched(): void;
  startTutorial(): void;
  tutorialNext(): void;
  tutorialBack(): void;
  tutorialReset(): void;
  tutorialRetry(): void;
  tutorialJump(lesson: number): void;
  exitTutorial(): void;
}

/** Whatever the server just refused, popping up over the current screen for a few seconds. */
function Toast() {
  const app = useApp();
  return (
    <>
      <Popup active={app.error} seq={app.errorSeq} className="toast" role="alert" sound="ui.error">
        {app.error && <ToastText message={app.error} />}
      </Popup>
      <Popup active={app.info} seq={app.infoSeq} className="toast info" role="status">
        {app.info && <OutText players={app.info.players} />}
      </Popup>
    </>
  );
}

/** Who has just dropped out, each name in their color. */
function OutText({ players }: { players: { name: string; color: number | null }[] }) {
  return (
    <>
      {players.map((player, index) => (
        <span key={index}>
          {index > 0 && (index === players.length - 1 ? ' and ' : ', ')}
          <strong
            className="out-name"
            style={
              player.color === null
                ? undefined
                : { color: `#${player.color.toString(16).padStart(6, '0')}` }
            }
          >
            {player.name}
          </strong>
        </span>
      ))}
      {players.length === 1 ? ' is' : ' are'} out of the match
    </>
  );
}

function Popup({
  active,
  seq,
  className,
  role,
  sound,
  children,
}: {
  active: unknown;
  seq: number;
  className: string;
  role: string;
  /** A sound to make as it appears. */
  sound?: string;
  children: ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }
    setVisible(true);
    if (sound) playSound(sound);
    const id = setTimeout(() => setVisible(false), TOAST_MS);
    return () => clearTimeout(id);
  }, [active, seq]);
  if (!active || !visible) return null;
  // Keyed by the sequence number, so a repeated message pops up again.
  return (
    <div key={seq} className={className} role={role}>
      {children}
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
      <SoundToggle />
    </>
  );
}

function Screen({ actions }: { actions: Actions }) {
  const app = useApp();
  // The dev sound list, at /?sounds.
  if (new URLSearchParams(location.search).has('sounds')) return <SoundPage />;
  if (app.tutorial) return <Tutorial actions={actions} view={app.tutorial} />;
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
  if (room.state === 'running' && app.launching) return <Loading actions={actions} />;
  // The end-of-match cards wait for their moment (see `cardReady`).
  if (room.state === 'finished') return app.cardReady ? <Results actions={actions} /> : null;
  return app.eliminated && app.cardReady ? <Out actions={actions} /> : null;
}
