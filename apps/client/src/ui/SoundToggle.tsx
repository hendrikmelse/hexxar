import { useSyncExternalStore } from 'react';
import { isMuted, setMuted, subscribeMuted } from '../audio/audio.js';

/**
 * The sound on/off button, fixed to the top right of every screen (menus, lobby, match, tutorial
 * and whatever comes next). It lives outside the screens so it is never left out.
 */
export function SoundToggle() {
  const muted = useSyncExternalStore(subscribeMuted, isMuted);
  const label = muted ? 'Turn sound on' : 'Turn sound off';
  return (
    <button
      className={`sound-toggle ${muted ? 'off' : ''}`}
      aria-label={label}
      aria-pressed={muted}
      title={label}
      data-sound="none"
      onClick={() => setMuted(!muted)}
    >
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z" fill="currentColor" />
        {muted ? (
          <path
            d="M15.5 9.5l5 5m0-5l-5 5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            fill="none"
          />
        ) : (
          <path
            d="M15 9a4 4 0 010 6m2.5-8.5a7.5 7.5 0 010 11"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            fill="none"
          />
        )}
      </svg>
    </button>
  );
}
