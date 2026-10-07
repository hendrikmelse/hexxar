import { tileRules, type MatchConfig } from './config.js';
import { hexKey, hexNeighbors } from './hex.js';
import type { Tile } from './state.js';
import type { TileGeneration, TileTypeId } from './tiles.js';

/**
 * How many of the tile's neighbors are farmland owned by the same player. Only cities and
 * villages produce troops, and each owned farm around them makes them produce faster.
 */
export function ownedFarmNeighbors(tiles: Readonly<Record<string, Tile>>, tile: Tile): number {
  if (tile.owner === null) return 0;
  let farms = 0;
  for (const neighbor of hexNeighbors(tile)) {
    const other = tiles[hexKey(neighbor)];
    if (other && other.type === 'farmland' && other.owner === tile.owner) farms++;
  }
  return farms;
}

/** Ticks per troop for a producer with the given number of owned farm neighbors, after the match's speed scale. */
function scaledInterval(config: MatchConfig, generation: TileGeneration, farms: number): number {
  const ticks = generation.everyTicks[Math.min(farms, generation.everyTicks.length - 1)] ?? 1;
  return Math.max(1, Math.round((ticks * 100) / config.generationSpeedPercent));
}

/**
 * Ticks between troops for a tile type given how many owned farms surround it, or `null` if
 * the type does not produce troops (farmland).
 */
export function generationInterval(
  config: MatchConfig,
  type: TileTypeId,
  farms: number,
): number | null {
  const { generation } = tileRules(config, type);
  return generation ? scaledInterval(config, generation, farms) : null;
}

/** Ticks per decay step for an oversized neutral army. The same for every tile type. */
export function decayInterval(config: MatchConfig): number {
  return Math.max(
    1,
    Math.round((config.neutralDecayEveryTicks * 100) / config.generationSpeedPercent),
  );
}

/** An owned producer at or above its cap stops generating, keeping its progress until it drops below. */
export function isGenerationPaused(config: MatchConfig, tile: Tile): boolean {
  const { generation } = tileRules(config, tile.type);
  return tile.owner !== null && generation !== null && tile.troops >= generation.cap;
}

/**
 * One tick of generation (owned cities and villages) or decay (oversized neutral
 * armies) for one tile. Each tile keeps its own progress counter, which starts at
 * zero when the tile is captured, so tiles taken on different ticks generate on
 * different ticks. The tile produces once its progress reaches the number of ticks
 * for its *current* farm count, so capturing a farm can complete a cycle early and
 * losing one makes it wait longer. A paused tile keeps its progress.
 *
 * `farms` is `ownedFarmNeighbors` for this tile, taken from the state before the tick.
 */
export function stepTile(
  config: MatchConfig,
  tile: Tile,
  farms: number,
): { troops: number; progress: number } {
  const rules = tileRules(config, tile.type);
  if (tile.owner === null) {
    if (tile.troops <= rules.baseGarrison) return { troops: tile.troops, progress: 0 };
    const progress = tile.progress + 1;
    return progress >= decayInterval(config)
      ? { troops: tile.troops - 1, progress: 0 }
      : { troops: tile.troops, progress };
  }
  const generation = rules.generation;
  if (!generation) return { troops: tile.troops, progress: tile.progress };
  if (isGenerationPaused(config, tile)) return { troops: tile.troops, progress: tile.progress };
  const progress = tile.progress + 1;
  return progress >= scaledInterval(config, generation, farms)
    ? { troops: tile.troops + generation.amount, progress: 0 }
    : { troops: tile.troops, progress };
}

/**
 * Bring a client's tiles up to date after a tick. The server's per-tick diff
 * leaves out tiles whose only change is generation progress, because that is
 * fully predictable: every tile not in `changed` just advances by `stepTile`,
 * using the neighbors' owners from before the tick, as the server did.
 * Mutates `tiles` and returns every tile that was touched.
 */
export function applyTickDiff(
  tiles: Record<string, Tile>,
  changed: readonly Tile[],
  config: MatchConfig,
): Tile[] {
  const before = { ...tiles };
  const touched: Tile[] = [];
  const fromServer = new Set<string>();
  for (const tile of changed) {
    const key = hexKey(tile);
    fromServer.add(key);
    tiles[key] = tile;
    touched.push(tile);
  }
  for (const [key, tile] of Object.entries(before)) {
    if (fromServer.has(key)) continue;
    const { progress } = stepTile(config, tile, ownedFarmNeighbors(before, tile));
    if (progress !== tile.progress) {
      const updated = { ...tile, progress };
      tiles[key] = updated;
      touched.push(updated);
    }
  }
  return touched;
}
