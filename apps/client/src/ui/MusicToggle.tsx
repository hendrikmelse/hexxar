import { useSyncExternalStore } from 'react';
import { track } from '../analytics.js';
import { isMusicMuted, setMusicMuted, subscribeMusicMuted } from '../audio/audio.js';

/**
 * The music on/off button, just left of the sound button in the top right of every screen. The
 * sounds (clicks, battles) have their own switch.
 */
export function MusicToggle() {
  const muted = useSyncExternalStore(subscribeMusicMuted, isMusicMuted);
  const label = muted ? 'Turn music on' : 'Turn music off';
  return (
    <button
      className={`sound-toggle music-toggle hint ${muted ? 'off' : ''}`}
      aria-label={label}
      aria-pressed={muted}
      data-tip={label}
      data-tip-pos="below-center"
      onClick={() => {
        track('music_toggle', { on: muted });
        setMusicMuted(!muted);
      }}
    >
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        {/* Two notes under one beam */}
        <path
          d="M9 18V6l10-2v12"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <circle cx="6.5" cy="18" r="2.5" fill="currentColor" />
        <circle cx="16.5" cy="16" r="2.5" fill="currentColor" />
        {muted && (
          <path
            d="M4 4l16 16"
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
