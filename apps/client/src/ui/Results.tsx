import type { RoomView } from '@hexxar/shared';
import { useApp } from '../store.js';
import type { Actions } from './App.js';

/** Shown over the board when the match is over. */
export function Results({ actions }: { actions: Actions }) {
  const app = useApp();
  const room = app.room as RoomView;
  const won = app.winner !== null && app.winner === app.matchPlayerId;
  const winnerName = room.players.find((p) => p.playerId === app.winner)?.name;

  let title = 'Match over';
  if (app.winner !== null) title = won ? 'Victory!' : `${winnerName ?? app.winner} wins`;

  return (
    <div className="results">
      <div className="card">
        <h2>{title}</h2>
        <button className="primary" onClick={actions.leaveRoom}>
          Main menu
        </button>
      </div>
    </div>
  );
}
