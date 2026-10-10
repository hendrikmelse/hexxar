import type { RoomView } from '@hexxar/shared';
import { useApp } from '../store.js';
import type { Actions } from './App.js';
import { Logo } from './Logo.js';

/** Shown in the middle of the board when the match is over. */
export function Results({ actions }: { actions: Actions }) {
  const app = useApp();
  const room = app.room as RoomView;
  const won = app.winner !== null && app.winner === app.matchPlayerId;
  const winnerName = room.players.find((p) => p.playerId === app.winner)?.name;

  // A win says so; anyone else is told the game is over (being knocked out mid-match is "Defeat").
  const banner = won ? 'Victory!' : 'GAME OVER';

  return (
    <div className="end-card">
      <div className="end-box" role="dialog" aria-label={banner}>
        <Logo banner={banner} tone={won ? 'win' : app.winner !== null ? 'lose' : 'neutral'} />
        {app.winner !== null && (
          <div className="winner">
            <h3 className="winner-label">Winner</h3>
            <div className="winner-line">
              <span
                className="winner-swatch"
                style={
                  app.winnerColor === null
                    ? undefined
                    : { background: `#${app.winnerColor.toString(16).padStart(6, '0')}` }
                }
              />
              <strong className="winner-name">{winnerName ?? app.winner}</strong>
            </div>
          </div>
        )}
        <div className="end-buttons">
          <button className="primary" data-sound="ui.back" onClick={actions.leaveRoom}>
            Main menu
          </button>
        </div>
      </div>
    </div>
  );
}
