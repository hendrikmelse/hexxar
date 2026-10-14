import { useApp } from '../store.js';
import type { Actions } from './App.js';
import { Logo } from './Logo.js';

/**
 * Shown over the board when you are out of a match that is still going: a card offering to watch
 * the rest or to leave, and then a small bar while you watch.
 * (Watching shows everything, fog included. That will need closing off someday.)
 */
export function Out({ actions }: { actions: Actions }) {
  const app = useApp();

  // Someone in a private room to watch is a spectator from the start.
  if (app.spectating || app.room?.spectating) {
    return (
      <div className="spectating">
        <span>Spectating</span>
        <button data-sound="ui.back" onClick={actions.leaveRoom}>
          Main menu
        </button>
      </div>
    );
  }

  // A quick game: the next one is a click away.
  const quickPlay = app.room?.visibility === 'public';

  return (
    <div className="end-card">
      <div className="end-box" role="dialog" aria-label="Defeat">
        <Logo banner="Defeat" tone="lose" />
        <div className={quickPlay ? 'end-buttons three' : 'end-buttons'}>
          <button data-sound="ui.back" onClick={actions.leaveRoom}>
            Main menu
          </button>
          {quickPlay ? (
            <>
              <button onClick={actions.spectate}>Spectate</button>
              <button
                className="primary"
                onClick={() => actions.playAgain(app.room!.settings.mode)}
              >
                Play again
              </button>
            </>
          ) : (
            <button className="primary" onClick={actions.spectate}>
              Spectate
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
