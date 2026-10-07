import { useState } from 'react';
import { DEFAULT_PREVIEW, effectiveSymmetry, type Actions, type PreviewOptions } from './App.js';

const MODES: { value: PreviewOptions['mode']; label: string }[] = [
  { value: '2', label: 'Duel (2 players)' },
  { value: '3', label: '3 players' },
  { value: '4', label: '4 players' },
  { value: '6', label: '6 players' },
  { value: 'ffa', label: 'Free-for-all' },
];
const FFA_PLAYERS = [3, 4, 5, 6, 8, 10, 12, 16, 20, 30, 50, 75, 100];
const RADII = [5, 6, 7, 8, 9, 10, 12, 15, 20, 30, 40];

/** Temporary tools for looking at generated maps while the generator is tuned. */
export function Preview({
  actions,
  preview,
}: {
  actions: Actions;
  preview: { seed: number; summary: string; error: string | null };
}) {
  const [options, setOptions] = useState<PreviewOptions>(DEFAULT_PREVIEW);

  // Changing an option generates a fresh map right away.
  const change = (patch: Partial<PreviewOptions>) => {
    const next = { ...options, ...patch };
    setOptions(next);
    actions.newPreview(next);
  };

  const symmetry = effectiveSymmetry(options);

  return (
    <div className="preview">
      <div className="row">
        <select
          value={options.mode}
          onChange={(e) => change({ mode: e.target.value as PreviewOptions['mode'] })}
        >
          {MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        {options.mode === 'ffa' && (
          <select
            value={options.players}
            onChange={(e) => change({ players: Number(e.target.value) })}
          >
            {FFA_PLAYERS.map((n) => (
              <option key={n} value={n}>
                {n} players
              </option>
            ))}
          </select>
        )}
        {symmetry !== null && (
          <select
            value={symmetry}
            disabled={options.mode !== '2'}
            title={options.mode === '2' ? 'Symmetry' : 'Fixed for this number of players'}
            onChange={(e) => change({ symmetry: e.target.value as PreviewOptions['symmetry'] })}
          >
            <option value="mirror">Mirror symmetry</option>
            <option value="rotational">Rotational symmetry</option>
          </select>
        )}
        <select
          value={options.shape}
          onChange={(e) => change({ shape: e.target.value as PreviewOptions['shape'] })}
        >
          <option value="random">Random shape</option>
          <option value="hexagon">Hexagon</option>
        </select>
        <select
          value={options.radius ?? 'auto'}
          onChange={(e) =>
            change({ radius: e.target.value === 'auto' ? null : Number(e.target.value) })
          }
        >
          <option value="auto">Recommended size</option>
          {RADII.map((r) => (
            <option key={r} value={r}>
              Radius {r}
            </option>
          ))}
        </select>
      </div>
      <div className="row">
        <button onClick={() => actions.newPreview(options)}>Generate new map</button>
        <button onClick={actions.exitPreview}>Back to menu</button>
      </div>
      <div className="info">seed {preview.seed}</div>
      <div className="info">{preview.summary}</div>
      {preview.error && <div className="info error">{preview.error}</div>}
    </div>
  );
}
