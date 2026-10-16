import { Logo } from './Logo.js';

/** The server has said it is restarting, and how long that usually takes. */
export interface RestartNotice {
  estimateMs: number;
}

const Dots = () => (
  <span className="dots" aria-hidden="true">
    <i>.</i>
    <i>.</i>
    <i>.</i>
  </span>
);

/** Shown while the connection to the server is being made, or remade. */
export function Connecting({
  reconnecting,
  restart,
  inMatch,
}: {
  reconnecting: boolean;
  restart: RestartNotice | null;
  /** A match is running for you, and will carry on once the server is back. */
  inMatch: boolean;
}) {
  if (restart) return <Restarting restart={restart} inMatch={inMatch} />;
  return (
    <div className="screen">
      <div className="connecting">
        <Logo />
        <p className="connecting-text" role="status">
          {reconnecting ? 'Reconnecting' : 'Connecting'}
          <Dots />
        </p>
      </div>
    </div>
  );
}

/** The server is being updated: say so, say how long it usually takes, and that the game will wait. */
function Restarting({ restart, inMatch }: { restart: RestartNotice; inMatch: boolean }) {
  // Said in steps of five seconds, rounded up: more exact would only pretend to know.
  const seconds = Math.max(5, Math.ceil(restart.estimateMs / 5000) * 5);
  return (
    <div className="screen">
      <div className="connecting restarting">
        <Logo />
        <p className="restart-title" role="status">
          The server is restarting to apply an update
        </p>
        {inMatch && <p className="restart-note">Your game is saved and will resume shortly.</p>}
        <p className="restart-eta">
          This usually takes less than {seconds} seconds
          <Dots />
        </p>
      </div>
    </div>
  );
}
