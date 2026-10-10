import { useEffect } from 'react';
import type { Actions } from './App.js';
import { Logo } from './Logo.js';

/** How long the bar takes to fill, and so how long the screen stays up. */
const LOADING_MS = 1500;

/** Shown between the lobby and the match, so the jump to the board is not so sudden. */
export function Loading({ actions }: { actions: Actions }) {
  useEffect(() => {
    const id = setTimeout(actions.launched, LOADING_MS);
    return () => clearTimeout(id);
  }, [actions]);
  return (
    <div className="screen">
      <div className="connecting">
        <Logo />
        <div
          className="loading-bar"
          role="progressbar"
          aria-label="Loading the match"
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <i style={{ animationDuration: `${LOADING_MS}ms` }} />
        </div>
      </div>
    </div>
  );
}
