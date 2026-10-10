import { useState } from 'react';
import { hasSound, playSound } from '../audio/audio.js';
import { SOUNDS, SOUND_GROUPS } from '../audio/sounds.js';

/** Open with `/?sounds`. Every sound the game should have, with a button to hear each one. */
export function SoundPage() {
  const [playing, setPlaying] = useState<string | null>(null);
  const made = SOUNDS.filter((entry) => hasSound(entry.id)).length;

  return (
    <div className="screen sound-page">
      <div className="sound-wrap">
        <header>
          <h2>Sounds</h2>
          <p className="muted">
            {made} of {SOUNDS.length} made. Put files in <code>public/sounds/</code> and set each
            one&apos;s <code>file</code> in <code>src/audio/sounds.ts</code>.
          </p>
          <a href={location.pathname}>Back to the game</a>
        </header>

        {SOUND_GROUPS.map((group) => (
          <section key={group} className="sound-group">
            <h3>{group}</h3>
            <ul>
              {SOUNDS.filter((entry) => entry.group === group).map((entry) => {
                const ready = hasSound(entry.id);
                return (
                  <li key={entry.id} className={ready ? 'ready' : ''}>
                    <button
                      className={playing === entry.id ? 'primary' : ''}
                      // The page plays the sound itself; no click on top of it.
                      data-sound="none"
                      disabled={!ready}
                      title={ready ? 'Play' : 'No sound file yet'}
                      onClick={() => {
                        playSound(entry.id);
                        setPlaying(entry.id);
                      }}
                    >
                      {ready ? 'Play' : 'No file'}
                    </button>
                    <div className="sound-text">
                      <strong>{entry.name}</strong>
                      <code>{entry.id}</code>
                      <span>{entry.description}</span>
                      <em>{entry.where}</em>
                      {entry.source && <small>{entry.source}</small>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
