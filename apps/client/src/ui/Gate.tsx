import { useState } from 'react';
import { useApp } from '../store.js';
import type { Actions } from './App.js';
import { Logo } from './Logo.js';

/** The beta is closed: ask for the access code before anything else. */
export function Gate({ actions }: { actions: Actions }) {
  const app = useApp();
  const [code, setCode] = useState('');
  const wrong = app.denied === 'wrong code';

  return (
    <div className="screen">
      <form
        className="card gate"
        onSubmit={(e) => {
          e.preventDefault();
          if (!code) return;
          actions.submitCode(code);
          // A wrong guess is cleared, ready for the next one.
          setCode('');
        }}
      >
        <Logo />
        <p className="muted center">Hexxar is in a closed beta. Enter your access code to play.</p>
        <input
          type="password"
          aria-label="Access code"
          placeholder="Access code"
          autoComplete="off"
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        {wrong && (
          <p className="error center" role="alert">
            That code isn&apos;t right.
          </p>
        )}
        <button type="submit" className="primary" disabled={!code}>
          Enter
        </button>
      </form>
    </div>
  );
}
