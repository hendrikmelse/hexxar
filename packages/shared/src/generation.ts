import { tileRules, type MatchConfig } from './config.js';
import { hexKey } from './hex.js';
import type { Tile } from './state.js';
import type { TileTypeId } from './tiles.js';

/** Ticks one generation cycle takes for a tile type, after the match's speed scale. */
export function generationInterval(config: MatchConfig, type: TileTypeId): number {
  const { everyTicks } = tileRules(config, type).generation;
  return Math.max(1, Math.round((everyTicks * 100) / config.generationSpeedPercent));
}

/** Ticks per decay step for an oversized neutral army: a fraction of the generation rate. */
export function decayInterval(config: MatchConfig, type: TileTypeId): number {
  const { everyTicks } = tileRules(config, type).generation;
  const scale = config.generationSpeedPercent * config.neutralDecayRatePercent;
  return Math.max(1, Math.round((everyTicks * 10_000) / scale));
}

/** An owned tile at or above its cap stops generating, keeping its progress until it drops below. */
export function isGenerationPaused(config: MatchConfig, tile: Tile): boolean {
  return tile.owner !== null && tile.troops >= tileRules(config, tile.type).generation.cap;
}

/**
 * One tick of generation (owned tiles) or decay (oversized neutral armies) for
 * one tile. Each tile keeps its own progress counter, which starts at zero when
 * the tile is captured, so tiles taken on different ticks generate on different
 * ticks. A paused tile keeps its progress.
 */
export function stepTile(config: MatchConfig, tile: Tile): { troops: number; progress: number } {
  const rules = tileRules(config, tile.type);
  if (tile.owner === null) {
    if (tile.troops <= rules.baseGarrison) return { troops: tile.troops, progress: 0 };
    const progress = tile.progress + 1;
    return progress >= decayInterval(config, tile.type)
      ? { troops: tile.troops - 1, progress: 0 }
      : { troops: tile.troops, progress };
  }
  if (isGenerationPaused(config, tile)) return { troops: tile.troops, progress: tile.progress };
  const progress = tile.progress + 1;
  return progress >= generationInterval(config, tile.type)
    ? { troops: tile.troops + rules.generation.amount, progress: 0 }
    : { troops: tile.troops, progress };
}

/**
 * Bring a client's tiles up to date after a tick. The server's per-tick diff
 * leaves out tiles whose only change is generation progress, because that is
 * fully predictable: every tile not in `changed` just advances by `stepTile`.
 * Mutates `tiles` and returns every tile that was touched.
 */
export function applyTickDiff(
  tiles: Record<string, Tile>,
  changed: readonly Tile[],
  config: MatchConfig,
): Tile[] {
  const touched: Tile[] = [];
  const fromServer = new Set<string>();
  for (const tile of changed) {
    const key = hexKey(tile);
    fromServer.add(key);
    tiles[key] = tile;
    touched.push(tile);
  }
  for (const [key, tile] of Object.entries(tiles)) {
    if (fromServer.has(key)) continue;
    const { progress } = stepTile(config, tile);
    if (progress !== tile.progress) {
      const updated = { ...tile, progress };
      tiles[key] = updated;
      touched.push(updated);
    }
  }
  return touched;
}
