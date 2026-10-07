import { z } from 'zod';

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
  /** Fog of war mode. Only `off` is implemented so far. */
  fog: z.enum(['off']).default('off'),
});

export type MatchConfig = z.infer<typeof matchConfigSchema>;

/** Fill in defaults for any fields the caller left out; throws on invalid values. */
export const parseMatchConfig = (input: unknown = {}): MatchConfig =>
  matchConfigSchema.parse(input);

export const DEFAULT_MATCH_CONFIG: MatchConfig = parseMatchConfig({});
export const DEFAULT_TICK_MS = DEFAULT_MATCH_CONFIG.tickMs;
