import { z } from 'zod';
import { TILE_TYPES, TILE_TYPE_IDS, type TileTypeDef, type TileTypeId } from './tiles.js';

/**
 * Per-match settings. Every match carries its own config so custom games can
 * tweak any of these; unspecified fields fall back to the defaults below.
 */
export const matchConfigSchema = z.object({
  /** Milliseconds between ticks. */
  tickMs: z.number().int().min(100).max(60_000).default(2000),
  /** Troop generation speed in percent (100 = normal, 200 = twice as fast). */
  generationSpeedPercent: z.number().int().min(10).max(1000).default(100),
  /** Troops on each player's starting tile. */
  startingTroops: z.number().int().min(1).max(1000).default(10),
  /** A neutral army above its tile's base garrison loses one troop every this many ticks. */
  neutralDecayEveryTicks: z.number().int().min(1).max(1000).default(6),
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
              everyTicks: z.number().int().min(1).max(10_000),
              amount: z.number().int().min(0).max(100),
              cap: z.number().int().min(0).max(100_000),
            })
            .partial(),
        })
        .partial(),
    )
    .default({}),
  /** Fog of war mode. Only `off` is implemented so far. */
  fog: z.enum(['off']).default('off'),
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
    generation: {
      everyTicks: override.generation?.everyTicks ?? base.generation.everyTicks,
      amount: override.generation?.amount ?? base.generation.amount,
      cap: override.generation?.cap ?? base.generation.cap,
    },
  };
}
