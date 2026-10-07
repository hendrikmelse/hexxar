import { describe, expect, it } from 'vitest';
import { parseMatchConfig } from './config.js';
import { createSymmetricMatch } from './generate.js';
import { applyTickDiff, generationInterval, stepTile } from './generation.js';
import { HEX_DIRECTIONS, hexKey } from './hex.js';
import type { Order, OrdersByPlayer } from './orders.js';
import { resolveTick } from './resolve.js';
import { createRng } from './rng.js';
import { diffTiles, type Tile } from './state.js';

const config = parseMatchConfig({});
const tile = (over: Partial<Tile>): Tile => ({
  q: 0,
  r: 0,
  type: 'city',
  owner: 'A',
  troops: 5,
  progress: 0,
  ...over,
});

describe('generation helpers', () => {
  it('computes cycle lengths from tile rules and speed', () => {
    expect(generationInterval(config, 'farmland')).toBe(24);
    expect(generationInterval(parseMatchConfig({ generationSpeedPercent: 200 }), 'farmland')).toBe(
      12,
    );
  });

  it('stepTile advances, generates, and pauses at the cap', () => {
    expect(stepTile(config, tile({ progress: 1 }))).toEqual({ troops: 5, progress: 2 });
    expect(stepTile(config, tile({ progress: 2 }))).toEqual({ troops: 6, progress: 0 });
    expect(stepTile(config, tile({ troops: 50, progress: 2 }))).toEqual({
      troops: 50,
      progress: 2,
    });
  });
});

describe('applyTickDiff', () => {
  /** A random game where clients only receive diffs must stay identical to the server. */
  it('reconstructs the server state from diffs for a whole random match', () => {
    // Fast generation and a low cap so generation, pausing, battles and captures all happen.
    const fast = {
      generationSpeedPercent: 400,
      tileOverrides: { city: { generation: { cap: 12 } }, farmland: { generation: { cap: 4 } } },
    };
    const { state: initial, config: matchConfig } = createSymmetricMatch({
      players: ['A', 'B'],
      seed: 21,
      radius: 4,
      config: fast,
    });
    const rng = createRng(77);

    let server = initial;
    const client: Record<string, Tile> = { ...initial.tiles };
    let captures = 0;
    for (let i = 0; i < 150 && server.winner === null; i++) {
      const orders: Record<string, Order> = {};
      for (const player of server.players) {
        const mine = Object.values(server.tiles).filter((t) => t.owner === player && t.troops > 1);
        const from = mine[rng.int(mine.length)];
        if (!from || rng.next() < 0.3) continue;
        const dir = HEX_DIRECTIONS[rng.int(6)]!;
        orders[player] = {
          type: 'move',
          from: { q: from.q, r: from.r },
          to: { q: from.q + dir.q, r: from.r + dir.r },
        };
      }
      const next = resolveTick(server, orders as OrdersByPlayer, matchConfig);
      captures += diffTiles(server, next).filter((t) => t.owner !== null).length;
      applyTickDiff(client, diffTiles(server, next), matchConfig);
      server = next;
      expect(client).toEqual(server.tiles);
    }
    expect(captures).toBeGreaterThan(20);
    expect(Object.keys(client).length).toBe(Object.keys(server.tiles).length);
    expect(hexKey({ q: 0, r: 0 })).toBe('0,0');
  });
});
