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

  if (app.spectating) {
    return (
      <div className="spectating">
        <span>Spectating</span>
        <button data-sound="ui.back" onClick={actions.leaveRoom}>
          Main menu
        </button>
      </div>
    );
  }

  return (
    <div className="end-card">
      <div className="end-box" role="dialog" aria-label="Defeat">
        <Logo banner="Defeat" tone="lose" />
        <div className="end-buttons">
          <button className="primary" onClick={actions.spectate}>
            Spectate
          </button>
          <button data-sound="ui.back" onClick={actions.leaveRoom}>
            Main menu
          </button>
        </div>
      </div>
    </div>
  );
}
