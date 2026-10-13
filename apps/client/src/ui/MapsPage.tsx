import { useEffect, useMemo, useState } from 'react';
import type { Graphics } from 'pixi.js';
import {
  ARCHETYPE_IDS,
  DEFAULT_GENERATION_PARAMS,
  DUEL_TILES,
  QUAD_TILES,
  SEXTET_TILES,
  TRIO_TILES,
  createQuadMatch,
  createSextetMatch,
  createTrioMatch,
  FFA_MAX_PLAYERS,
  FFA_MIN_PLAYERS,
  MAP_SIZES,
  corridorPath,
  createFreeForAllMatch,
  createDuelMatch,
  parseMatchConfig,
  ROYALE_START_DISTANCE,
  royaleTilesPerPlayer,
  type ArchetypeId,
  type GameState,
  type GenerationParams,
  type MapSize,
  type DuelAxis,
  type DuelReport,
  type DuelSymmetry,
  type QuadReport,
  type SextetReport,
  type TrioReport,
  type RoomMode,
  type RoyaleReport,
  type Blueprint,
} from '@hexxar/shared';
import { emptyGame, type GameView } from '../game.js';
import { HEX_SIZE } from '../layout.js';
import { preview } from '../preview.js';
import { Segmented } from './Lobby.js';

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

/** The blueprint, drawn over the board: a circle for each blob and a strip for each corridor. */
function blueprintOverlay(blueprint: Blueprint | null): ((graphics: Graphics) => void) | null {
  if (!blueprint) return null;
  return (g) => {
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
  };
}

/** What the previewer can make: the game's two modes, and the boards for three, four and six players. */
type PreviewMode = RoomMode | 'trio' | 'quad' | 'six';

/** A board, and for battle royales how it was made. Or the reason it could not be made. */
type Generated =
  | {
      state: GameState;
      report: RoyaleReport | null;
      duel: DuelReport | null;
      trio: TrioReport | null;
      quad: QuadReport | null;
      sextet: SextetReport | null;
    }
  | string;

/** Make a board the way a room would for these settings. */
function generate(
  mode: PreviewMode,
  tiles: number,
  players: number,
  seed: number,
  params: GenerationParams,
  archetype: ArchetypeId | 'random',
  symmetry: DuelSymmetry | 'random',
  axis: DuelAxis | 'random',
  turns?: number,
): Generated {
  const ids = Array.from({ length: players }, (_, i) => `p${i}`);
  try {
    if (mode === 'ffa') {
      const { state, report } = createFreeForAllMatch({ players: ids, seed, params, archetype });
      return { state, report, duel: null, trio: null, quad: null, sextet: null };
    }
    if (mode === 'trio') {
      const { state, trio } = createTrioMatch({ players: ids, seed, tiles, params });
      return { state, report: null, duel: null, trio, quad: null, sextet: null };
    }
    if (mode === 'quad') {
      const { state, quad } = createQuadMatch({ players: ids, seed, tiles, params, turns });
      return { state, report: null, duel: null, trio: null, quad, sextet: null };
    }
    if (mode === 'six') {
      const { state, sextet } = createSextetMatch({
        players: ids,
        seed,
        tiles,
        symmetry: symmetry === 'random' ? undefined : symmetry,
        axis: axis === 'random' ? undefined : axis,
        params,
      });
      return { state, report: null, duel: null, trio: null, quad: null, sextet };
    }
    const { state, duel } = createDuelMatch({
      players: ids,
      seed,
      tiles,
      symmetry: symmetry === 'random' ? undefined : symmetry,
      axis: axis === 'random' ? undefined : axis,
      turns,
      params,
    });
    return { state, report: null, duel, trio: null, quad: null, sextet: null };
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
  const [mode, setMode] = useState<PreviewMode>(
    (['duel', 'trio', 'quad', 'six', 'ffa'] as const).find(
      (value) => value === query.get('mode'),
    ) ?? 'duel',
  );
  const [mapSize, setMapSize] = useState<MapSize>(
    MAP_SIZES.find((size) => size === query.get('size')) ?? 'normal',
  );
  const [players, setPlayers] = useState(
    Math.min(FFA_MAX_PLAYERS, Math.max(FFA_MIN_PLAYERS, queryNumber('players') ?? 4)),
  );
  // How far a mirror board is turned, from the address only (`turns=0` to `5`); otherwise random.
  const [duelTurns] = useState<number | undefined>(() => {
    const turns = queryNumber('turns');
    return turns === null ? undefined : turns;
  });
  const [duelAxis, setDuelAxis] = useState<DuelAxis | 'random'>(
    query.get('axis') === 'points' || query.get('axis') === 'edges'
      ? (query.get('axis') as DuelAxis)
      : 'random',
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
  /** About how many tiles a fair board has at a map size, for as many players as the mode has. */
  const tilesFor = (forMode: PreviewMode, size: MapSize): number =>
    forMode === 'trio'
      ? TRIO_TILES[size]
      : forMode === 'quad'
        ? QUAD_TILES[size]
        : forMode === 'six'
          ? SEXTET_TILES[size]
          : DUEL_TILES[size];
  const [tiles, setTiles] = useState<number>(queryNumber('tiles') ?? tilesFor(mode, mapSize));

  const defaultTiles = tilesFor(mode, mapSize);
  const chooseMode = (next: PreviewMode): void => {
    setMode(next);
    setTiles(tilesFor(next, mapSize));
  };
  const chooseSize = (size: MapSize): void => {
    setMapSize(size);
    setParams(sizeDefaults(size, players));
    setTiles(tilesFor(mode, size));
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
  if (mode !== 'ffa' && tiles !== defaultTiles) changes.tiles = tiles;

  const count =
    mode === 'duel' ? 2 : mode === 'trio' ? 3 : mode === 'quad' ? 4 : mode === 'six' ? 6 : players;
  const result = useMemo(
    () => generate(mode, tiles, count, seed, params, archetype, duelSymmetry, duelAxis, duelTurns),
    [mode, tiles, count, seed, params, archetype, duelSymmetry, duelAxis, duelTurns],
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
        const board = generate(
          'ffa',
          tiles,
          players,
          first + i,
          params,
          archetype,
          duelSymmetry,
          duelAxis,
        );
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
  const trio = typeof result === 'string' ? null : result.trio;
  const quad = typeof result === 'string' ? null : result.quad;
  const sextet = typeof result === 'string' ? null : result.sextet;
  const blueprint =
    report?.blueprint ??
    duel?.blueprint ??
    trio?.blueprint ??
    quad?.blueprint ??
    sextet?.blueprint ??
    null;

  // The board itself is the game's own, drawn by `main.ts`: hand it each new board, then the overlays.
  const game = useMemo(
    () => (typeof result === 'string' ? null : toGameView(result.state)),
    [result],
  );
  useEffect(() => {
    if (game) preview.show(game);
  }, [game]);
  useEffect(() => {
    preview.overlay(game ? blueprintOverlay(showBlueprint ? blueprint : null) : null);
    return () => preview.overlay(null);
  }, [game, blueprint, showBlueprint]);

  return (
    <div className="maps-panel">
      <div className="maps-wrap">
        <header>
          <h2>Map preview</h2>
          <a href={location.pathname}>Back to the game</a>
        </header>

        <div className="maps-controls">
          <Segmented
            label="Game mode"
            value={mode}
            options={[
              { value: 'duel', label: 'Duel' },
              { value: 'trio', label: 'Trio' },
              { value: 'quad', label: 'Quad' },
              { value: 'six', label: 'Sextet' },
              { value: 'ffa', label: 'Royale' },
            ]}
            onChange={chooseMode}
          />
          <Segmented
            label="Map size"
            value={mapSize}
            options={MAP_SIZES.map((value) => ({
              value,
              label: value[0]!.toUpperCase() + value.slice(1),
            }))}
            onChange={chooseSize}
          />
          {mode === 'trio' || mode === 'quad' ? null : mode === 'duel' || mode === 'six' ? (
            <>
              <Segmented
                label="Symmetry"
                value={duelSymmetry}
                options={[
                  { value: 'random', label: 'Random' },
                  { value: 'mirror', label: 'Mirror' },
                  { value: 'rotational', label: mode === 'six' ? 'Sixth turns' : 'Half turn' },
                ]}
                onChange={setDuelSymmetry}
              />
              {duelSymmetry !== 'rotational' && (
                <Segmented
                  label="Mirror line"
                  value={duelAxis}
                  options={[
                    { value: 'random', label: 'Either' },
                    { value: 'points', label: 'Tile points' },
                    { value: 'edges', label: 'Tile edges' },
                  ]}
                  onChange={setDuelAxis}
                />
              )}
            </>
          ) : (
            <>
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
              <Segmented
                label="Archetype"
                value={archetype}
                options={(['random', ...ARCHETYPE_IDS] as const).map((id) => ({
                  value: id,
                  label: id[0]!.toUpperCase() + id.slice(1),
                }))}
                onChange={setArchetype}
              />
            </>
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
        </div>

        <details className="maps-params">
          <summary>
            Generation parameters{Object.keys(changes).length > 0 ? ' (changed)' : ''}
          </summary>
          {mode !== 'ffa' && (
            <div className="maps-group">
              <h4>
                {mode === 'trio'
                  ? 'Three-player board'
                  : mode === 'quad'
                    ? 'Four-player board'
                    : mode === 'six'
                      ? 'Six-player board'
                      : 'Duel board'}
              </h4>
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
          {sextet &&
            ` · ${sextet.symmetry === 'rotational' ? 'turns of 60°' : `turns of 120° and mirrors (through tile ${sextet.axis})`}, ${sextet.attempts} ${sextet.attempts === 1 ? 'attempt' : 'attempts'} · ${sextet.blueprint.chambers.length} blobs`}
          {quad &&
            ` · two mirror lines, turned ${quad.turns * 60}°, ${quad.attempts} ${quad.attempts === 1 ? 'attempt' : 'attempts'} · ${quad.blueprint.chambers.length} blobs`}
          {trio &&
            ` · turns of 120°, ${trio.attempts} ${trio.attempts === 1 ? 'attempt' : 'attempts'} · ${trio.blueprint.chambers.length} blobs`}
          {duel &&
            ` · ${duel.symmetry}${duel.symmetry === 'mirror' ? ` (through tile ${duel.axis}, turned ${duel.turns * 60}°)` : ''}, ${duel.attempts} ${duel.attempts === 1 ? 'attempt' : 'attempts'}` +
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
