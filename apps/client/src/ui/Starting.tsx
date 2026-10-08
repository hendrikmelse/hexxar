import type { RoomView } from '@hexxar/shared';
import { useApp } from '../store.js';
import { useCountdown } from './Lobby.js';

/** The short countdown between the lobby and the first tick. */
export function Starting() {
  const app = useApp();
  const room = app.room as RoomView;
  const seconds = useCountdown(room.startsAt, app.clockOffset);

  return (
    <div className="screen">
      <div className="starting">
        <h2>Starting match…</h2>
        {/* Keyed by the number so it pops each time it changes. */}
        <div key={seconds ?? 0} className="starting-count">
          {seconds ?? ''}
        </div>
        <p className="muted">
          {room.players.length} {room.players.length === 1 ? 'player' : 'players'}
        </p>
      </div>
    </div>
  );
}
