import { useState } from 'react';
import { useApp } from '../store.js';
import { DEFAULT_PREVIEW, type Actions } from './App.js';

export function Menu({ actions }: { actions: Actions }) {
  const app = useApp();
  const [code, setCode] = useState('');

  return (
    <div className="screen">
      <div className="card menu">
        <h1>Hexxar</h1>
        <label className="field">
          <span>Your name</span>
          <input
            value={app.name}
            maxLength={24}
            onChange={(e) => actions.setName(e.target.value)}
          />
        </label>
        <button className="primary" onClick={actions.quickPlay}>
          Quick play · Duel
        </button>
        <button onClick={actions.createRoom}>Create a private game</button>
        <form
          className="join"
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
            Join
          </button>
        </form>
        {app.error && <p className="error">{app.error}</p>}
        <button className="link" onClick={() => actions.startPreview(DEFAULT_PREVIEW)}>
          Preview generated maps (dev)
        </button>
      </div>
    </div>
  );
}
