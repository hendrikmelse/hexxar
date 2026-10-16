import { useEffect, useState, type ReactNode } from 'react';
import { playSound } from '../audio/audio.js';
import type { RoomMode, RoomSettingsPatch } from '@hexxar/shared';
import { useApp } from '../store.js';
import { Admin } from './Admin.js';
import { BotTag } from './BotTag.js';
import { Connecting } from './Connecting.js';
import { MapsPage } from './MapsPage.js';
import { Loading } from './Loading.js';
import { Lobby } from './Lobby.js';
import { Menu } from './Menu.js';
import { Footer, PRIVACY_PATH } from './Footer.js';
import { Privacy } from './Privacy.js';
import { Out } from './Out.js';
import { Results } from './Results.js';
import { Feedback } from './Feedback.js';
import { FeedbackToggle } from './FeedbackToggle.js';
import { FullscreenToggle } from './FullscreenToggle.js';
import { SoundToggle } from './SoundToggle.js';
import { SoundPage } from './SoundPage.js';
import { Tutorial } from './Tutorial.js';

/** Everything the screens can ask the app to do. */
export interface Actions {
  setName(name: string): void;
  quickPlay(mode: RoomMode): void;
  /** Leave this quick game and look for another of the same mode. */
  playAgain(mode: RoomMode): void;
  /** Leave this quick game and open a private one of this mode, with bots already added. */
  playWithBots(mode: RoomMode): void;
  createRoom(): void;
  joinRoom(code: string): void;
  updateRoom(patch: RoomSettingsPatch): void;
  startGame(): void;
  voteStart(vote: boolean): void;
  leaveRoom(): void;
  returnToRoom(): void;
  sendChat(text: string): void;
  becomeSpectator(): void;
  becomePlayer(): void;
  spectate(): void;
  launched(): void;
  startTutorial(): void;
  tutorialNext(): void;
  tutorialBack(): void;
  tutorialStartClock(): void;
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
        {app.info?.players && <OutText players={app.info.players} />}
        {app.info?.message}
      </Popup>
    </>
  );
}

/** Who has just dropped out, each name in their color. */
function OutText({
  players,
}: {
  players: { name: string; color: number | null; bot?: boolean }[];
}) {
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
            {player.bot && (
              <>
                {' '}
                <BotTag />
              </>
            )}
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

const isAdminPage = (): boolean => new URLSearchParams(location.search).has('admin');

/** Picks the screen: menu, lobby, or (over the board) the results. */
export function App({ actions }: { actions: Actions }) {
  return (
    <>
      <Screen actions={actions} />
      <Toast />
      {!isAdminPage() && (
        <>
          <FeedbackToggle />
          <FullscreenToggle />
          <SoundToggle />
        </>
      )}
    </>
  );
}

/** A menu page, with the quiet row of links under it. (Not the match, nor the cards over it.) */
const withFooter = (page: ReactNode) => (
  <>
    {page}
    <Footer />
  </>
);

function Screen({ actions }: { actions: Actions }) {
  const app = useApp();
  // The dev sound list, at /?sounds.
  if (new URLSearchParams(location.search).has('sounds')) return <SoundPage />;
  // The admin panel, at /?admin (it asks for a password).
  if (isAdminPage()) return <Admin />;
  // The dev map previewer, at /?maps.
  if (new URLSearchParams(location.search).has('maps')) return <MapsPage />;
  // The feedback page, opened from the button in the corner, takes the whole screen (over the
  // privacy policy too: Back goes to whichever page it was opened from).
  if (app.feedbackOpen) return withFooter(<Feedback />);
  // The privacy policy is a page of its own, at /privacy.
  if (app.path.replace(/\/+$/, '') === PRIVACY_PATH) return withFooter(<Privacy />);
  if (app.tutorial) return <Tutorial actions={actions} view={app.tutorial} />;
  if (!app.connected) {
    // Once we have been connected, a dropped connection is a reconnect.
    return withFooter(<Connecting reconnecting={app.userId !== null} />);
  }
  // Wait for the server's welcome before showing the menu.
  if (app.userId === null) return withFooter(<Connecting reconnecting={false} />);
  const room = app.room;
  if (!room) return withFooter(<Menu actions={actions} />);
  if (room.state === 'lobby') return withFooter(<Lobby actions={actions} />);
  if (room.state === 'running' && app.launching) return withFooter(<Loading actions={actions} />);
  // The end-of-match cards wait for their moment (see `cardReady`).
  // Once the card has been closed, the player is a spectator of the finished match, with nothing
  // left to watch but the chat to carry on in.
  if (room.state === 'finished') {
    if (!app.cardReady) return null;
    return app.spectating ? <Out actions={actions} /> : <Results actions={actions} />;
  }
  if (room.spectating) return <Out actions={actions} />;
  return app.eliminated && app.cardReady ? <Out actions={actions} /> : null;
}
