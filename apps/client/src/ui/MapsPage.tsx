import { useEffect, useMemo, useState } from 'react';
import type { Graphics } from 'pixi.js';
import {
  ARCHETYPE_IDS,
  DEFAULT_GENERATION_PARAMS,
  extraSetsFor,
  FAIR_BOWL_RADIUS,
  createQuadMatch,
  createSextetMatch,
  createTrioMatch,
  FFA_MAX_PLAYERS,
  FFA_MIN_PLAYERS,
  MAP_SIZES,
  corridorPath,
  createFreeForAllMatch,
  createRng,
  createDuelMatch,
  parseMatchConfig,
  bowlRadiusFor,
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
function toGameView(state: GameState, viewer: string | null): GameView {
  return {
    ...emptyGame(),
    status: 'playing',
    // With a viewer the board is drawn as that player sees it, covered in fog.
    playerId: viewer,
    config: parseMatchConfig({ fog: viewer === null ? 'off' : 'on' }),
    tiles: { ...state.tiles },
    players: [...state.players],
  };
}

/** How many players a board of this mode is for (a battle royale has as many as were chosen). */
const playersOf = (mode: PreviewMode, royalePlayers: number): number =>
  mode === 'duel'
    ? 2
    : mode === 'trio'
      ? 3
      : mode === 'quad'
        ? 4
        : mode === 'six'
          ? 6
          : royalePlayers;

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
      const { state, trio } = createTrioMatch({ players: ids, seed, params });
      return { state, report: null, duel: null, trio, quad: null, sextet: null };
    }
    if (mode === 'quad') {
      const { state, quad } = createQuadMatch({ players: ids, seed, params, turns });
      return { state, report: null, duel: null, trio: null, quad, sextet: null };
    }
    if (mode === 'six') {
      const { state, sextet } = createSextetMatch({
        players: ids,
        seed,
        symmetry: symmetry === 'random' ? undefined : symmetry,
        axis: axis === 'random' ? undefined : axis,
        params,
      });
      return { state, report: null, duel: null, trio: null, quad: null, sextet };
    }
    const { state, duel } = createDuelMatch({
      players: ids,
      seed,
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

type NumberKey = {
  [K in keyof GenerationParams]-?: Exclude<GenerationParams[K], undefined> extends number
    ? K
    : never;
}[keyof GenerationParams];

/** The generation parameters, in the groups `params.ts` keeps them in, with what each one does. */
const PARAM_GROUPS: { title: string; fields: { key: NumberKey; hint: string }[] }[] = [
  {
    title: 'Board size',
    fields: [
      { key: 'bowlRadius', hint: 'Radius of every start bowl, which decides the board size' },
      {
        key: 'extraSets',
        hint: 'Fair boards: sets of extra blobs besides the starts (battle royales have none)',
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
  key: 'villagesNextToCities';
  label: string;
}[] = [
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
  const [showFog, setShowFog] = useState(query.has('fog'));

  // What a room would use for this map size and number of players; anything changed by hand is
  // shown against it.
  const sizeDefaults = (
    size: MapSize,
    forMode: PreviewMode,
    royalePlayers: number,
  ): GenerationParams =>
    forMode === 'ffa'
      ? { ...DEFAULT_GENERATION_PARAMS, bowlRadius: bowlRadiusFor(size, royalePlayers) }
      : {
          ...DEFAULT_GENERATION_PARAMS,
          bowlRadius: FAIR_BOWL_RADIUS[size],
          extraSets: extraSetsFor(size, playersOf(forMode, royalePlayers)),
        };
  const [params, setParams] = useState<GenerationParams>(() =>
    sizeDefaults(mapSize, mode, players),
  );
  const chooseMode = (next: PreviewMode): void => {
    setMode(next);
    setParams(sizeDefaults(mapSize, next, players));
  };
  const chooseSize = (size: MapSize): void => {
    setMapSize(size);
    setParams(sizeDefaults(size, mode, players));
  };
  const chooseRoyalePlayers = (count: number): void => {
    setPlayers(count);
    setParams((current) => ({
      ...current,
      bowlRadius: bowlRadiusFor(mapSize, count),
    }));
  };
  const baseline = sizeDefaults(mapSize, mode, players);
  const changes: Record<string, number | boolean> = {};
  for (const key of Object.keys(params) as (keyof GenerationParams)[]) {
    const value = params[key];
    if (value !== undefined && value !== baseline[key]) changes[key] = value;
  }

  const count = playersOf(mode, players);
  const result = useMemo(
    () => generate(mode, count, seed, params, archetype, duelSymmetry, duelAxis, duelTurns),
    [mode, count, seed, params, archetype, duelSymmetry, duelAxis, duelTurns],
  );

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
  const game = useMemo(() => {
    if (typeof result === 'string') return null;
    // Whose eyes: one of the players, picked by the seed (so a new map is a new color).
    const viewer = showFog
      ? (result.state.players[Math.floor(createRng(seed).next() * count)] ?? null)
      : null;
    return toGameView(result.state, viewer);
  }, [result, showFog, seed, count]);
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
          <label className="maps-flag">
            <input
              type="checkbox"
              checked={showFog}
              onChange={(event) => setShowFog(event.target.checked)}
            />
            Show fog
          </label>
        </div>

        <details className="maps-params">
          <summary>
            Generation parameters{Object.keys(changes).length > 0 ? ' (changed)' : ''}
          </summary>
          {PARAM_GROUPS.map((group) => (
            <div key={group.title} className="maps-group">
              <h4>{group.title}</h4>
              <div className="maps-fields">
                {group.fields
                  .filter(({ key }) => !(key === 'extraSets' && mode === 'ffa'))
                  .map(({ key, hint }) => (
                    <NumberField
                      key={key}
                      label={key}
                      hint={hint}
                      value={params[key] ?? 0}
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
            ` · ${sextet.symmetry === 'rotational' ? 'turns of 60°' : `turns of 120° and mirrors (through tile ${sextet.axis})`} · ${sextet.blueprint.chambers.length} blobs`}
          {quad &&
            ` · two mirror lines, turned ${quad.turns * 60}° · ${quad.blueprint.chambers.length} blobs`}
          {trio && ` · turns of 120° · ${trio.blueprint.chambers.length} blobs`}
          {duel &&
            ` · ${duel.symmetry}${duel.symmetry === 'mirror' ? ` (through tile ${duel.axis}, turned ${duel.turns * 60}°)` : ''}` +
              ` · ${duel.blueprint.chambers.length} blobs`}
          {report && ` · ${report.archetype} · bowl radius ${params.bowlRadius.toFixed(2)}`}
        </p>
      </div>
    </div>
  );
}
