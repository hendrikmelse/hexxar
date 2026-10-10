import { z } from 'zod';
import { TILE_TYPES, TILE_TYPE_IDS, type TileTypeDef, type TileTypeId } from './tiles.js';

/**
 * Per-match settings. Every match carries its own config so custom games can
 * tweak any of these; unspecified fields fall back to the defaults below.
 */
export const matchConfigSchema = z.object({
  /** Milliseconds between ticks. The default here is the game's tick length (not a server setting). */
  tickMs: z.number().int().min(100).max(60_000).default(1200),
  /** Troop generation speed in percent (100 = normal, 200 = twice as fast). */
  generationSpeedPercent: z.number().int().min(10).max(1000).default(100),
  /** Troops on each player's starting tile. */
  startingTroops: z.number().int().min(1).max(1000).default(10),
  /** Override any tile type's rules for this match; unspecified values keep their defaults. */
  tileOverrides: z
    .partialRecord(
      z.enum(TILE_TYPE_IDS),
      z
        .object({
          defensePercent: z.number().int().min(1).max(1000),
          baseGarrison: z.number().int().min(0).max(1000),
          generation: z
            .object({
              // Ticks per troop for 0 to 6 owned neighboring farms.
              everyTicks: z.array(z.number().int().min(1).max(10_000)).length(7),
              amount: z.number().int().min(0).max(100),
              cap: z.number().int().min(0).max(100_000),
            })
            .partial(),
        })
        .partial(),
    )
    .default({}),
  /**
   * Fog of war. `on`: you see your own tiles and the ring around them in full, the ring beyond
   * that as owner and type only, and nothing else (see `vision.ts`). `off`: everything.
   */
  fog: z.enum(['off', 'on']).default('on'),
});

export type MatchConfig = z.infer<typeof matchConfigSchema>;

/** Fill in defaults for any fields the caller left out; throws on invalid values. */
export const parseMatchConfig = (input: unknown = {}): MatchConfig =>
  matchConfigSchema.parse(input);

export const DEFAULT_MATCH_CONFIG: MatchConfig = parseMatchConfig({});
export const DEFAULT_TICK_MS = DEFAULT_MATCH_CONFIG.tickMs;

/** A tile type's rules for this match: the built-in defaults plus any overrides. */
export function tileRules(config: MatchConfig, id: TileTypeId): TileTypeDef {
  const base = TILE_TYPES[id];
  const override = config.tileOverrides[id];
  if (!override) return base;
  return {
    id: base.id,
    name: base.name,
    defensePercent: override.defensePercent ?? base.defensePercent,
    baseGarrison: override.baseGarrison ?? base.baseGarrison,
    // Farmland has no generation to override.
    generation: base.generation && {
      everyTicks: override.generation?.everyTicks ?? base.generation.everyTicks,
      amount: override.generation?.amount ?? base.generation.amount,
      cap: override.generation?.cap ?? base.generation.cap,
    },
  };
}
