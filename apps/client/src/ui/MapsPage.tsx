import { useEffect, useMemo, useState } from 'react';
import type { Graphics } from 'pixi.js';
import {
  ARCHETYPE_IDS,
  DEFAULT_GENERATION_PARAMS,
  DUEL_TILES,
  FFA_MAX_PLAYERS,
  FFA_MIN_PLAYERS,
  MAP_SIZES,
  corridorPath,
  createFreeForAllMatch,
  createDuelMatch,
  hexKey,
  parseMatchConfig,
  ROYALE_START_DISTANCE,
  royaleTilesPerPlayer,
  territories,
  type ArchetypeId,
  type GameState,
  type GenerationParams,
  type MapSize,
  type DuelReport,
  type DuelSymmetry,
  type RoomMode,
  type RoyaleReport,
  type Blueprint,
} from '@hexxar/shared';
import { playerColor } from '../board.js';
import { emptyGame, type GameView } from '../game.js';
import { HEX_SIZE, hexCorners, hexToPixel } from '../layout.js';
import { preview } from '../preview.js';

const randomSeed = (): number => Math.floor(Math.random() * 0x7fffffff);

/** A generated board as the client's board drawing wants it: a match nobody is playing in. */
function toGameView(state: GameState): GameView {
  return {
    ...emptyGame(),
    status: 'playing',
    config: parseMatchConfig({}),
    tiles: { ...state.tiles },
    players: [...state.players],
  };
}

/** The blueprint is drawn in tile units; one unit is the distance between neighboring hex centers. */
const UNIT = HEX_SIZE * Math.sqrt(3);
const BLUEPRINT_COLOR = 0xffd166;
const NEUTRAL_CHAMBER_COLOR = 0x9db4ff;

/** What to draw over the board, or `null` for nothing. */
function overlayFor(
  game: GameView,
  blueprint: Blueprint | null,
  show: { blueprint: boolean; territories: boolean },
): ((graphics: Graphics) => void) | null {
  if (!blueprint || !(show.blueprint || show.territories)) return null;
  return (g) => {
    if (show.territories) {
      // Tint every tile with the color of the player whose city is nearest (by walking).
      const tiles = Object.values(game.tiles);
      const starts = tiles.filter((tile) => tile.owner !== null);
      const split = territories(new Map(tiles.map((tile) => [hexKey(tile), tile])), starts);
      for (const [key, index] of split.owner) {
        const color = playerColor(game, starts[index]!.owner) ?? 0xffffff;
        g.poly(hexCorners(hexToPixel(game.tiles[key]!), 1.5)).fill({ color, alpha: 0.4 });
      }
    }
    if (show.blueprint) {
      for (const corridor of blueprint.corridors) {
        const [first, ...rest] = corridorPath(blueprint, corridor);
        g.moveTo(first!.x * UNIT, first!.y * UNIT);
        for (const point of rest) g.lineTo(point.x * UNIT, point.y * UNIT);
        g.stroke({
          width: Math.max(3, corridor.width * UNIT * 0.3),
          color: BLUEPRINT_COLOR,
          alpha: 0.3,
          cap: 'round',
          join: 'round',
        });
      }
      for (const chamber of blueprint.chambers) {
        g.circle(chamber.center.x * UNIT, chamber.center.y * UNIT, chamber.radius * UNIT).stroke({
          width: 2,
          color: chamber.spawn ? BLUEPRINT_COLOR : NEUTRAL_CHAMBER_COLOR,
          alpha: 0.9,
        });
      }
    }
  };
}

/** A board, and for battle royales how it was made. Or the reason it could not be made. */
type Generated =
  { state: GameState; report: RoyaleReport | null; duel: DuelReport | null } | string;

/** Make a board the way a room would for these settings. */
function generate(
  mode: RoomMode,
  tiles: number,
  players: number,
  seed: number,
  params: GenerationParams,
  archetype: ArchetypeId | 'random',
  symmetry: DuelSymmetry | 'random',
): Generated {
  const ids = Array.from({ length: players }, (_, i) => `p${i}`);
  try {
    if (mode === 'ffa') {
      const { state, report } = createFreeForAllMatch({ players: ids, seed, params, archetype });
      return { state, report, duel: null };
    }
    const { state, duel } = createDuelMatch({
      players: ids,
      seed,
      tiles,
      symmetry: symmetry === 'random' ? undefined : symmetry,
      params,
    });
    return { state, report: null, duel };
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** What many seeds of one set of settings add up to, to judge a generator by more than one board. */
interface Stats {
  runs: number;
  failures: number;
  attempts: number;
  maxAttempts: number;
  tiles: number;
  chokes: number;
  cutChokes: number;
  interiorShare: number;
  fairnessScore: number;
  worstReachRatio: number;
  widths: number[];
  rejections: Record<string, number>;
  milliseconds: number;
}

const STATS_RUNS = 100;

type NumberKey = {
  [K in keyof GenerationParams]: GenerationParams[K] extends number ? K : never;
}[keyof GenerationParams];

/** The generation parameters, in the groups `params.ts` keeps them in, with what each one does. */
const PARAM_GROUPS: { title: string; fields: { key: NumberKey; hint: string }[] }[] = [
  {
    title: 'Battle royale terrain',
    fields: [
      { key: 'tilesPerPlayer', hint: 'Tiles of board per player, which decides the board size' },
      {
        key: 'minTilesPerPlayer',
        hint: 'Boards never get less than this per player (0 for no floor)',
      },
      { key: 'minStartDistance', hint: 'Starting cities are never closer than this' },
      {
        key: 'fairnessCandidates',
        hint: 'This many valid boards are drawn and the fairest is used (1 is the first valid one)',
      },
    ],
  },
  {
    title: 'Coast (all boards)',
    fields: [
      { key: 'coastRoughness', hint: 'How far noise pushes the coast in and out, in tiles' },
      { key: 'coastDetail', hint: 'Size of the coast bumps, in tiles' },
      { key: 'warpStrength', hint: 'How far noise bends the blobs out of round, in tiles' },
    ],
  },
  {
    title: 'Cities and villages',
    fields: [
      {
        key: 'tilesPerCity',
        hint: 'About one extra city per this many tiles on duel boards (battle royales have none)',
      },
      { key: 'minCityDistance', hint: 'Cities are never closer than this to each other' },
      { key: 'villageChance', hint: 'Percent chance a village is placed where one fits' },
      {
        key: 'minVillageDistance',
        hint: 'Villages are never closer than this (2: they never touch)',
      },
    ],
  },
];

/** On/off settings, shown in the group of the same title. */
const FLAGS: {
  group: string;
  key: 'villagesNextToCities' | 'checkFairness';
  label: string;
}[] = [
  {
    group: 'Battle royale terrain',
    key: 'checkFairness',
    label: 'Check fairness (equal exits for every start, reject lopsided boards, best of several)',
  },
  { group: 'Cities and villages', key: 'villagesNextToCities', label: 'Villages may touch cities' },
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

/** The numbers from a batch of boards. */
function StatsTable({ stats }: { stats: Stats }) {
  const ok = Math.max(1, stats.runs - stats.failures);
  const rejected = Object.entries(stats.rejections)
    .map(([reason, n]) => `${reason} ${n}`)
    .join(', ');
  const rows: [string, string][] = [
    ['boards made', `${stats.runs - stats.failures} of ${stats.runs} (${stats.failures} failed)`],
    ['attempts per board', `${(stats.attempts / ok).toFixed(2)} (worst ${stats.maxAttempts})`],
    ['rejected candidates', rejected || 'none'],
    ['tiles', (stats.tiles / ok).toFixed(0)],
    [
      'chokes per board',
      `${(stats.chokes / ok).toFixed(1)} (${(stats.cutChokes / ok).toFixed(1)} cut the map)`,
    ],
    [
      'chokes by width',
      stats.widths
        .slice(1)
        .map((n, i) => `${i + 1}: ${(n / ok).toFixed(1)}`)
        .join(', '),
    ],
    ['deep inland', `${Math.round((stats.interiorShare / ok) * 100)}%`],
    ['unfairness score', `${(stats.fairnessScore / ok).toFixed(2)} (0 is perfectly even)`],
    ['nearby land, best over worst player', `${(stats.worstReachRatio / ok).toFixed(2)}×`],
    ['time per board', `${(stats.milliseconds / stats.runs).toFixed(0)} ms`],
  ];
  return (
    <table className="maps-stats">
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <th>{label}</th>
            <td>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Open with `/?maps`. Generates boards with the same settings a room uses, to look them over. */
export function MapsPage() {
  // The address can set where to start (`?maps&mode=ffa&size=large&players=8&seed=123`), to get
  // back to a board or share one; everything is changed on the page itself from there.
  const [query] = useState(() => new URLSearchParams(location.search));
  const queryNumber = (name: string): number | null => {
    const value = query.get(name);
    return value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
  };
  const [mode, setMode] = useState<RoomMode>(query.get('mode') === 'ffa' ? 'ffa' : 'duel');
  const [mapSize, setMapSize] = useState<MapSize>(
    MAP_SIZES.find((size) => size === query.get('size')) ?? 'normal',
  );
  const [players, setPlayers] = useState(
    Math.min(FFA_MAX_PLAYERS, Math.max(FFA_MIN_PLAYERS, queryNumber('players') ?? 4)),
  );
  const [duelSymmetry, setDuelSymmetry] = useState<DuelSymmetry | 'random'>(
    query.get('symmetry') === 'mirror' || query.get('symmetry') === 'rotational'
      ? (query.get('symmetry') as DuelSymmetry)
      : 'random',
  );
  const [seed, setSeed] = useState(() => queryNumber('seed') ?? randomSeed());
  const [archetype, setArchetype] = useState<ArchetypeId | 'random'>(
    ARCHETYPE_IDS.find((id) => id === query.get('archetype')) ?? 'random',
  );
  const [showBlueprint, setShowBlueprint] = useState(query.has('blueprint'));
  const [showTerritories, setShowTerritories] = useState(query.has('territories'));
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsRunning, setStatsRunning] = useState(false);

  // What a room would use for this map size and number of players; anything changed by hand is
  // shown against it.
  const sizeDefaults = (size: MapSize, royalePlayers: number): GenerationParams => ({
    ...DEFAULT_GENERATION_PARAMS,
    tilesPerPlayer: royaleTilesPerPlayer(size, royalePlayers),
    minStartDistance: ROYALE_START_DISTANCE[size],
  });
  const [params, setParams] = useState<GenerationParams>(() => sizeDefaults(mapSize, players));
  const [tiles, setTiles] = useState<number>(queryNumber('tiles') ?? DUEL_TILES[mapSize]);

  const defaultTiles = DUEL_TILES[mapSize];
  const chooseSize = (size: MapSize): void => {
    setMapSize(size);
    setParams(sizeDefaults(size, players));
    setTiles(DUEL_TILES[size]);
  };
  const chooseRoyalePlayers = (count: number): void => {
    setPlayers(count);
    setParams((current) => ({
      ...current,
      tilesPerPlayer: royaleTilesPerPlayer(mapSize, count),
    }));
  };
  const baseline = sizeDefaults(mapSize, players);
  const changes: Record<string, number | boolean> = {};
  for (const key of Object.keys(params) as (keyof GenerationParams)[]) {
    if (params[key] !== baseline[key]) changes[key] = params[key];
  }
  if (mode === 'duel' && tiles !== defaultTiles) changes.tiles = tiles;

  const count = mode === 'duel' ? 2 : players;
  const result = useMemo(
    () => generate(mode, tiles, count, seed, params, archetype, duelSymmetry),
    [mode, tiles, count, seed, params, archetype, duelSymmetry],
  );

  /** Make many boards one slice at a time, so the page stays usable while it works. */
  const runStats = (): void => {
    setStatsRunning(true);
    const total: Stats = {
      runs: 0,
      failures: 0,
      attempts: 0,
      maxAttempts: 0,
      tiles: 0,
      chokes: 0,
      cutChokes: 0,
      interiorShare: 0,
      fairnessScore: 0,
      worstReachRatio: 0,
      widths: [],
      rejections: {},
      milliseconds: 0,
    };
    const first = randomSeed();
    const step = (done: number): void => {
      const started = performance.now();
      for (let i = done; i < Math.min(done + 5, STATS_RUNS); i++) {
        const board = generate('ffa', tiles, players, first + i, params, archetype, duelSymmetry);
        total.runs++;
        if (typeof board === 'string' || !board.report) {
          total.failures++;
          continue;
        }
        const { report } = board;
        total.attempts += report.attempts;
        total.maxAttempts = Math.max(total.maxAttempts, report.attempts);
        total.tiles += report.metrics.tiles;
        total.chokes += report.metrics.chokes.length;
        total.cutChokes += report.metrics.chokes.filter((choke) => choke.cut).length;
        total.interiorShare += report.metrics.interiorShare;
        total.fairnessScore += report.fairness.score;
        total.worstReachRatio += report.fairness.reachRatio;
        report.metrics.widths.forEach((n, width) => {
          total.widths[width] = (total.widths[width] ?? 0) + n;
        });
        for (const [reason, n] of Object.entries(report.rejections)) {
          total.rejections[reason] = (total.rejections[reason] ?? 0) + n;
        }
      }
      total.milliseconds += performance.now() - started;
      setStats({ ...total, widths: [...total.widths], rejections: { ...total.rejections } });
      if (done + 5 < STATS_RUNS) setTimeout(() => step(done + 5), 0);
      else setStatsRunning(false);
    };
    step(0);
  };

  const tileCount = typeof result === 'string' ? 0 : Object.keys(result.state.tiles).length;
  const report = typeof result === 'string' ? null : result.report;
  const duel = typeof result === 'string' ? null : result.duel;
  const blueprint = report?.blueprint ?? duel?.blueprint ?? null;

  // The board itself is the game's own, drawn by `main.ts`: hand it each new board, then the overlays.
  const game = useMemo(
    () => (typeof result === 'string' ? null : toGameView(result.state)),
    [result],
  );
  useEffect(() => {
    if (game) preview.show(game);
  }, [game]);
  useEffect(() => {
    preview.overlay(
      game
        ? overlayFor(game, blueprint, { blueprint: showBlueprint, territories: showTerritories })
        : null,
    );
    return () => preview.overlay(null);
  }, [game, blueprint, showBlueprint, showTerritories]);

  return (
    <div className="maps-panel">
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
                {value === 'duel' ? 'Duel' : 'Battle royale'}
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
              {(['random', 'mirror', 'rotational'] as const).map((value) => (
                <button
                  key={value}
                  className={duelSymmetry === value ? 'primary' : ''}
                  data-sound="none"
                  onClick={() => setDuelSymmetry(value)}
                >
                  {value[0]!.toUpperCase() + value.slice(1)}
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
                onChange={(event) => chooseRoyalePlayers(Number(event.target.value))}
              />
            </label>
          )}
          {mode === 'ffa' && (
            <label className="maps-players">
              Archetype{' '}
              <select
                value={archetype}
                onChange={(event) => setArchetype(event.target.value as ArchetypeId | 'random')}
              >
                {(['random', ...ARCHETYPE_IDS] as const).map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button className="primary" data-sound="none" onClick={() => setSeed(randomSeed())}>
            Generate new map
          </button>
          <label className="maps-flag">
            <input
              type="checkbox"
              checked={showBlueprint}
              onChange={(event) => setShowBlueprint(event.target.checked)}
            />
            Show blueprint
          </label>
          <label className="maps-flag">
            <input
              type="checkbox"
              checked={showTerritories}
              onChange={(event) => setShowTerritories(event.target.checked)}
            />
            Show territories
          </label>
        </div>

        <details className="maps-params">
          <summary>
            Generation parameters{Object.keys(changes).length > 0 ? ' (changed)' : ''}
          </summary>
          {mode === 'duel' && (
            <div className="maps-group">
              <h4>Duel board</h4>
              <div className="maps-fields">
                <NumberField
                  label="tiles"
                  hint="About how many tiles the board has"
                  value={tiles}
                  step={1}
                  changed={tiles !== defaultTiles}
                  onChange={setTiles}
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
                {FLAGS.filter((flag) => flag.group === group.title).map(({ key, label }) => (
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
                setTiles(defaultTiles);
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
          {duel &&
            ` · ${duel.symmetry}, ${duel.attempts} ${duel.attempts === 1 ? 'attempt' : 'attempts'}` +
              ` · ${duel.blueprint.chambers.length} blobs`}
          {report &&
            ` · ${report.archetype}, ${report.attempts} ${report.attempts === 1 ? 'attempt' : 'attempts'}` +
              ` · ${report.metrics.chokes.length} chokes (${report.metrics.widths
                .slice(1)
                .map((n, i) => `${n}×${i + 1}`)
                .join(
                  ', ',
                )} wide, ${report.metrics.chokes.filter((c) => c.cut).length} cut the map)` +
              ` · ${report.metrics.loops} loops, ${report.metrics.deadEnds} dead ends` +
              ` · ${Math.round(report.metrics.interiorShare * 100)}% deep inland` +
              ` · fairness ${report.fairness.score.toFixed(2)} (best of ${report.compared}; nearby land ${report.fairness.reachRatio.toFixed(1)}×)`}
        </p>

        {mode === 'ffa' && (
          <details className="maps-params">
            <summary>
              Statistics over {STATS_RUNS} seeds{stats ? ` (${stats.runs} done)` : ''}
            </summary>
            <div className="maps-actions">
              <button data-sound="none" disabled={statsRunning} onClick={runStats}>
                {statsRunning ? 'Working…' : 'Run'}
              </button>
            </div>
            {stats && stats.runs > 0 && <StatsTable stats={stats} />}
          </details>
        )}
      </div>
    </div>
  );
}
