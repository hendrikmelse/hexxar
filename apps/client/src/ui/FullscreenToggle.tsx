import { useEffect, useState } from 'react';

/**
 * The fullscreen button, just left of the sound button in the top right of every screen. Left out
 * where the browser has no fullscreen (iPhones, for one). Escape leaves fullscreen, as always.
 */
export function FullscreenToggle() {
  const [full, setFull] = useState(() => document.fullscreenElement !== null);
  useEffect(() => {
    const update = (): void => setFull(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);
  if (!document.fullscreenEnabled) return null;

  const label = full ? 'Leave fullscreen' : 'Fullscreen';
  const toggle = (): void => {
    // The browser may refuse (it only allows this from a click); there is nothing to tell the player.
    const request = full ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    request.catch(() => undefined);
  };
  return (
    <button
      className="sound-toggle fullscreen-toggle"
      aria-label={label}
      title={label}
      data-sound="none"
      onClick={toggle}
    >
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path
          d={full ? 'M9 4v5H4m16 0h-5V4M4 15h5v5m6 0v-5h5' : 'M4 9V4h5m6 0h5v5m0 6v5h-5M9 20H4v-5'}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    </button>
  );
}
