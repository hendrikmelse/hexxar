import { useEffect, useRef, useState } from 'react';
import { DEFAULT_GENERATION_PARAMS, type GenerationParams } from '@hexxar/shared';
import { DEFAULT_PREVIEW, effectiveSymmetry, type Actions, type PreviewOptions } from './App.js';
import { PARAM_GROUPS, type Applies, type ParamDef } from './paramDefs.js';

const MODES: { value: PreviewOptions['mode']; label: string }[] = [
  { value: '2', label: 'Duel (2 players)' },
  { value: '3', label: '3 players' },
  { value: '4', label: '4 players' },
  { value: '6', label: '6 players' },
  { value: 'ffa', label: 'Battle Royale' },
];
const FFA_PLAYERS = [3, 4, 5, 6, 8, 10, 12, 16, 20, 30, 50, 75, 100];
const RADII = [5, 6, 7, 8, 9, 10, 12, 15, 20, 30, 40];

/** How long to wait after the last slider movement before generating a new map. */
const SLIDER_DELAY_MS = 150;

type PreviewInfo = { seed: number; summary: string; error: string | null };

/** Temporary tools for looking at generated maps while the generator is tuned. */
export function Preview({ actions, preview }: { actions: Actions; preview: PreviewInfo }) {
  const [options, setOptions] = useState<PreviewOptions>(DEFAULT_PREVIEW);
  const [keepSeed, setKeepSeed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const seedFor = (): number | null => (keepSeed ? preview.seed : null);

  /** Show the options in the controls now and generate a new map, right away or shortly. */
  const apply = (next: PreviewOptions, delay = 0) => {
    setOptions(next);
    if (timer.current) clearTimeout(timer.current);
    const generate = () => actions.newPreview({ ...next, seed: seedFor() });
    if (delay === 0) generate();
    else timer.current = setTimeout(generate, delay);
  };
  const change = (patch: Partial<PreviewOptions>) => apply({ ...options, ...patch });
  const changeParam = <K extends keyof GenerationParams>(key: K, value: GenerationParams[K]) =>
    apply({ ...options, params: { ...options.params, [key]: value } }, SLIDER_DELAY_MS);

  const symmetry = effectiveSymmetry(options);

  return (
    <>
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
          {options.mode !== 'ffa' && (
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
          )}
        </div>
        <div className="row">
          <button onClick={() => actions.newPreview({ ...options, seed: null })}>
            Generate new map
          </button>
          <button onClick={actions.exitPreview}>Back to menu</button>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={keepSeed}
            onChange={(e) => setKeepSeed(e.target.checked)}
          />
          Keep this seed while changing settings
        </label>
        <div className="info">seed {preview.seed}</div>
        <div className="info">{preview.summary}</div>
        {preview.error && <div className="info error">{preview.error}</div>}
      </div>

      <div className="params">
        <div className="params-head">
          <strong>Generation settings</strong>
          <button onClick={() => apply({ ...options, params: DEFAULT_GENERATION_PARAMS })}>
            Reset all
          </button>
        </div>
        {PARAM_GROUPS.map((group) => (
          <fieldset key={group.title}>
            <legend>{group.title}</legend>
            {group.params.map((def) => (
              <ParamControl
                key={def.key}
                def={def}
                params={options.params}
                active={isActive(def, options)}
                onNumber={(key, value) => changeParam(key, value)}
                onBool={(key, value) => changeParam(key, value)}
              />
            ))}
          </fieldset>
        ))}
      </div>
    </>
  );
}

/** Does the setting do anything for the board being previewed? */
function isActive(def: ParamDef, options: PreviewOptions): boolean {
  // City density also applies to battle royale boards once they are allowed extra cities.
  if (def.key === 'tilesPerCity') return options.mode !== 'ffa' || options.params.freeForAllCities;
  switch (def.applies) {
    case 'always':
      return true;
    case 'random':
      return options.shape === 'random';
    case 'symmetric':
      return options.mode !== 'ffa';
    case 'ffa':
      return options.mode === 'ffa';
  }
}

const NOTES: Partial<Record<Applies, string>> = {
  random: 'random shapes only',
  symmetric: 'symmetric boards only',
  ffa: 'battle royale only',
};

function ParamControl({
  def,
  params,
  active,
  onNumber,
  onBool,
}: {
  def: ParamDef;
  params: GenerationParams;
  active: boolean;
  onNumber: (key: Extract<ParamDef, { kind: 'number' }>['key'], value: number) => void;
  onBool: (key: Extract<ParamDef, { kind: 'bool' }>['key'], value: boolean) => void;
}) {
  const note = NOTES[def.applies];
  const title = note ? `${def.hint} (${note})` : def.hint;

  if (def.kind === 'bool') {
    return (
      <label className={`param check ${active ? '' : 'inactive'}`} title={title}>
        <input
          type="checkbox"
          checked={params[def.key]}
          onChange={(e) => onBool(def.key, e.target.checked)}
        />
        {def.label}
      </label>
    );
  }

  const value = params[def.key];
  return (
    <label className={`param ${active ? '' : 'inactive'}`} title={title}>
      <span className="param-head">
        <span>{def.label}</span>
        <output>{def.format ? def.format(value) : String(Math.round(value * 100) / 100)}</output>
      </span>
      <input
        type="range"
        min={def.min}
        max={def.max}
        step={def.step}
        value={value}
        onChange={(e) => onNumber(def.key, Number(e.target.value))}
      />
    </label>
  );
}
