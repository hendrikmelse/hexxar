import { useState } from 'react';
import { useApp } from '../store.js';
import type { Actions } from './App.js';
import { Logo } from './Logo.js';

export function Menu({ actions }: { actions: Actions }) {
  const app = useApp();
  const [code, setCode] = useState('');

  return (
    <div className="screen">
      <div className="card menu">
        <Logo />
        <label className="field">
          <span>Your name</span>
          <input
            value={app.name}
            maxLength={24}
            onChange={(e) => actions.setName(e.target.value)}
          />
        </label>

        <section className="menu-section">
          <h3>Quick play</h3>
          <div className="tiles">
            <button className="primary mode" onClick={() => actions.quickPlay('ffa')}>
              <strong>Battle Royale</strong>
              <Activity count={app.activity?.ffa} />
            </button>
            <button className="primary mode" onClick={() => actions.quickPlay('duel')}>
              <strong>Duel</strong>
              <Activity count={app.activity?.duel} />
            </button>
          </div>
        </section>

        <section className="menu-section">
          <h3>New here?</h3>
          <button className="learn" onClick={actions.startTutorial}>
            Play tutorial
          </button>
        </section>

        <section className="menu-section">
          <h3>Private games</h3>
          <div className="tiles">
            <button className="mode" onClick={actions.createRoom}>
              <strong>Create game</strong>
              <small>Get a code to share</small>
            </button>
            <form
              className="join-tile"
              onSubmit={(e) => {
                e.preventDefault();
                if (code.trim()) actions.joinRoom(code.trim());
              }}
            >
              <input
                placeholder="Game code"
                value={code}
                maxLength={12}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
              <button type="submit" disabled={!code.trim()}>
                Join game
              </button>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}

/** How many people are online in a mode right now, with a small pulsing "live" dot. */
function Activity({ count }: { count: number | undefined }) {
  return (
    <small className="activity">
      <span className="live-dot" aria-hidden="true" />
      {count === undefined ? '...' : count} online
    </small>
  );
}
