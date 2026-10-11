import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_GENERATION_PARAMS,
  symmetricRadius,
  FFA_MAX_PLAYERS,
  FFA_MIN_PLAYERS,
  MAP_SIZES,
  ROYALE_TILES_PER_PLAYER,
  createFreeForAllMatch,
  createSymmetricMatch,
  type GameState,
  type GenerationParams,
  type MapSize,
  type RoomMode,
} from '@hexxar/shared';
import { NEUTRAL_FILL, PLAYER_COLORS } from '../board.js';
import { HEX_SIZE, hexCorners, hexToPixel } from '../layout.js';

const css = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

const randomSeed = (): number => Math.floor(Math.random() * 0x7fffffff);

/** The player counts a symmetric board supports. */
const SYMMETRIC_PLAYERS = [2, 3, 4, 6] as const;

/** Make a board the way a room would for these settings. */
function generate(
  mode: RoomMode,
  radius: number,
  players: number,
  seed: number,
  params: GenerationParams,
): GameState | string {
  const ids = Array.from({ length: players }, (_, i) => `p${i}`);
  try {
    return mode === 'ffa'
      ? createFreeForAllMatch({ players: ids, seed, params }).state
      : createSymmetricMatch({ players: ids, seed, radius, params }).state;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

type NumberKey = {
  [K in keyof GenerationParams]: GenerationParams[K] extends number ? K : never;
}[keyof GenerationParams];

/** The generation parameters, in the groups `params.ts` keeps them in, with what each one does. */
const PARAM_GROUPS: { title: string; fields: { key: NumberKey; hint: string }[] }[] = [
  {
    title: 'Outline',
    fields: [
      {
        key: 'outlineScale',
        hint: 'Size of the outline circle relative to a hexagon of the same radius',
      },
      { key: 'waveCount', hint: 'How many waves bend the outline (0 is a plain circle)' },
      { key: 'waveStrength', hint: 'How far the waves push the outline in and out' },
      { key: 'waveDetail', hint: 'The highest wave frequency; higher gives finer lobes' },
      { key: 'jaggedness', hint: 'How rough the coast is, in tiles' },
      {
        key: 'minAreaRatio',
        hint: 'A shape is kept only if its area is at least this fraction of the hexagon',
      },
      {
        key: 'maxAreaRatio',
        hint: 'A shape is kept only if its area is at most this fraction of the hexagon',
      },
    ],
  },
  {
    title: 'Lakes',
    fields: [
      { key: 'tilesPerLake', hint: 'About one lake per this many tiles (0 for none)' },
      {
        key: 'lakeCountVariation',
        hint: 'How far the number of lakes may stray from the expected number, in percent either way',
      },
      {
        key: 'maxTotalLakePercent',
        hint: 'The most water all the lakes together may take, as a percentage of the board',
      },
      { key: 'minLakeSize', hint: 'Smallest lake, in tiles' },
      { key: 'maxLakePercent', hint: 'Biggest a lake may be, as a percentage of the board' },
      { key: 'maxLakeSize', hint: 'Absolute cap on lake size, in tiles' },
      { key: 'lakeClearance', hint: 'Tiles of land kept between a lake and the coast' },
    ],
  },
  {
    title: 'Cities and villages',
    fields: [
      {
        key: 'tilesPerCity',
        hint: 'About one extra city per this many tiles (symmetric boards; royales only with the option below)',
      },
      { key: 'minCityDistance', hint: 'Cities are never closer than this to each other' },
      { key: 'villageChance', hint: 'Percent chance a village is placed where one fits' },
      {
        key: 'minVillageDistance',
        hint: 'Villages are never closer than this (2: they never touch)',
      },
    ],
  },
  {
    title: 'Starting positions',
    fields: [
      {
        key: 'startInset',
        hint: 'Symmetric boards: starting cities sit this many tiles in from the edge',
      },
      { key: 'startRoom', hint: 'Rings of land kept around each starting city on random shapes' },
      {
        key: 'tilesPerPlayer',
        hint: 'Battle royales: tiles of board per player, which decides the board size',
      },
    ],
  },
];

const FLAGS: { key: 'freeForAllCities' | 'villagesNextToCities'; label: string }[] = [
  { key: 'freeForAllCities', label: 'Extra cities on royale boards' },
  { key: 'villagesNextToCities', label: 'Villages may touch cities' },
];

/** A number box that lets you type half-finished numbers ("0.") and only passes on whole ones. */
function NumberField({
  label,
  hint,
  value,
  step,
  changed,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  step: number;
  changed: boolean;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  // Follow the value when something else changes it (a reset, or the map size).
  useEffect(() => {
    if (Number(text) !== value) setText(String(value));
  }, [value]);
  return (
    <label className={`maps-field ${changed ? 'changed' : ''}`} title={hint}>
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          const next = event.target.valueAsNumber;
          if (Number.isFinite(next)) onChange(next);
        }}
      />
    </label>
  );
}

/** Open with `/?maps`. Generates boards with the same settings a room uses, to look them over. */
export function MapsPage() {
  const [mode, setMode] = useState<RoomMode>('duel');
  const [mapSize, setMapSize] = useState<MapSize>('normal');
  const [players, setPlayers] = useState(4);
  const [symmetricPlayers, setSymmetricPlayers] = useState<number>(2);
  const [seed, setSeed] = useState(randomSeed);

  // What a room would use for this map size; anything changed by hand is shown against it.
  const sizeDefaults = (size: MapSize): GenerationParams => ({
    ...DEFAULT_GENERATION_PARAMS,
    tilesPerPlayer: ROYALE_TILES_PER_PLAYER[size],
  });
  const [params, setParams] = useState<GenerationParams>(() => sizeDefaults('normal'));
  const [radius, setRadius] = useState<number>(symmetricRadius('normal', 2));

  // The radius that gives each player about the same land, for this size and number of players.
  const defaultRadius = symmetricRadius(mapSize, symmetricPlayers);
  const chooseSize = (size: MapSize): void => {
    setMapSize(size);
    setParams(sizeDefaults(size));
    setRadius(symmetricRadius(size, symmetricPlayers));
  };
  const choosePlayers = (count: number): void => {
    setSymmetricPlayers(count);
    setRadius(symmetricRadius(mapSize, count));
  };
  const baseline = sizeDefaults(mapSize);
  const changes: Record<string, number | boolean> = {};
  for (const key of Object.keys(params) as (keyof GenerationParams)[]) {
    if (params[key] !== baseline[key]) changes[key] = params[key];
  }
  if (mode === 'duel' && radius !== defaultRadius) changes.radius = radius;

  const count = mode === 'duel' ? symmetricPlayers : players;
  const result = useMemo(
    () => generate(mode, radius, count, seed, params),
    [mode, radius, count, seed, params],
  );

  const picture = useMemo(() => {
    if (typeof result === 'string') return null;
    const tiles = Object.values(result.tiles);
    const centers = tiles.map((tile) => hexToPixel(tile));
    const pad = HEX_SIZE * 1.2;
    const minX = Math.min(...centers.map((c) => c.x)) - pad;
    const maxX = Math.max(...centers.map((c) => c.x)) + pad;
    const minY = Math.min(...centers.map((c) => c.y)) - pad;
    const maxY = Math.max(...centers.map((c) => c.y)) + pad;
    return { tiles, box: `${minX} ${minY} ${maxX - minX} ${maxY - minY}` };
  }, [result]);

  const tileCount = typeof result === 'string' ? 0 : Object.keys(result.tiles).length;

  return (
    <div className="screen maps-page">
      <div className="maps-wrap">
        <header>
          <h2>Map preview</h2>
          <a href={location.pathname}>Back to the game</a>
        </header>

        <div className="maps-controls">
          <div className="maps-choice">
            {(['duel', 'ffa'] as const).map((value) => (
              <button
                key={value}
                className={mode === value ? 'primary' : ''}
                data-sound="none"
                onClick={() => setMode(value)}
              >
                {value === 'duel' ? 'Symmetric (duel)' : 'Battle royale'}
              </button>
            ))}
          </div>
          <div className="maps-choice">
            {MAP_SIZES.map((value) => (
              <button
                key={value}
                className={mapSize === value ? 'primary' : ''}
                data-sound="none"
                onClick={() => chooseSize(value)}
              >
                {value[0]!.toUpperCase() + value.slice(1)}
              </button>
            ))}
          </div>
          {mode === 'duel' ? (
            <div className="maps-choice">
              {SYMMETRIC_PLAYERS.map((value) => (
                <button
                  key={value}
                  className={symmetricPlayers === value ? 'primary' : ''}
                  data-sound="none"
                  onClick={() => choosePlayers(value)}
                >
                  {value} players
                </button>
              ))}
            </div>
          ) : (
            <label className="maps-players">
              Players: {players}
              <input
                type="range"
                min={FFA_MIN_PLAYERS}
                max={FFA_MAX_PLAYERS}
                value={players}
                onChange={(event) => setPlayers(Number(event.target.value))}
              />
            </label>
          )}
          <button className="primary" data-sound="none" onClick={() => setSeed(randomSeed())}>
            Generate new map
          </button>
        </div>

        <details className="maps-params">
          <summary>
            Generation parameters{Object.keys(changes).length > 0 ? ' (changed)' : ''}
          </summary>
          {mode === 'duel' && (
            <div className="maps-group">
              <h4>Symmetric board</h4>
              <div className="maps-fields">
                <NumberField
                  label="radius"
                  hint="Board radius, in tiles"
                  value={radius}
                  step={1}
                  changed={radius !== defaultRadius}
                  onChange={setRadius}
                />
              </div>
            </div>
          )}
          {PARAM_GROUPS.map((group) => (
            <div key={group.title} className="maps-group">
              <h4>{group.title}</h4>
              <div className="maps-fields">
                {group.fields.map(({ key, hint }) => (
                  <NumberField
                    key={key}
                    label={key}
                    hint={hint}
                    value={params[key]}
                    step={Number.isInteger(DEFAULT_GENERATION_PARAMS[key]) ? 1 : 0.05}
                    changed={params[key] !== baseline[key]}
                    onChange={(value) => setParams({ ...params, [key]: value })}
                  />
                ))}
                {group.title === 'Cities and villages' &&
                  FLAGS.map(({ key, label }) => (
                    <label key={key} className="maps-flag">
                      <input
                        type="checkbox"
                        checked={params[key]}
                        onChange={(event) => setParams({ ...params, [key]: event.target.checked })}
                      />
                      {label}
                    </label>
                  ))}
              </div>
            </div>
          ))}
          <div className="maps-actions">
            <button
              data-sound="none"
              onClick={() => {
                setParams(baseline);
                setRadius(defaultRadius);
              }}
            >
              Reset to this size&apos;s defaults
            </button>
          </div>
          <p className="muted">Changed from the defaults (for putting into the code):</p>
          <pre className="maps-changes">{JSON.stringify(changes, null, 2)}</pre>
        </details>

        <p className="muted">
          {typeof result === 'string' ? result : `${tileCount} tiles`} · seed {seed}
        </p>

        {picture && (
          <svg className="maps-board" viewBox={picture.box} role="img" aria-label="Map preview">
            {picture.tiles.map((tile) => {
              const owner =
                typeof result === 'string' ? -1 : result.players.indexOf(tile.owner ?? '');
              const fill =
                tile.owner !== null && owner >= 0
                  ? css(PLAYER_COLORS[owner % PLAYER_COLORS.length]!)
                  : css(NEUTRAL_FILL[tile.type]);
              const center = hexToPixel(tile);
              const points = hexCorners(center, 1.5).join(' ');
              return (
                <g key={`${tile.q},${tile.r}`}>
                  <polygon points={points} fill={fill} opacity={tile.owner !== null ? 0.85 : 1} />
                  {tile.type !== 'farmland' && (
                    <text
                      x={center.x}
                      y={center.y + 6}
                      textAnchor="middle"
                      fontSize={tile.type === 'city' ? 20 : 14}
                      fontWeight="800"
                      fill={tile.type === 'city' ? '#ffffff' : '#c9d0de'}
                    >
                      {tile.type === 'city' ? 'C' : 'V'}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}
