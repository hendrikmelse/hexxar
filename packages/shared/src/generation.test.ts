import { describe, expect, it } from 'vitest';
import { parseMatchConfig } from './config.js';
import { createSymmetricMatch } from './generate.js';
import {
  applyTickDiff,
  decayInterval,
  generationInterval,
  ownedFarmNeighbors,
  stepTile,
} from './generation.js';
import { HEX_DIRECTIONS, hexKey, hexNeighbors } from './hex.js';
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

describe('farm bonus', () => {
  /** A producer at the origin with its six neighbors as farmland: the first `owned` are A's, then `enemy` are B's. */
  const surrounded = (type: 'city' | 'village', owned: number, enemy = 0): Record<string, Tile> => {
    const tiles: Record<string, Tile> = {};
    tiles['0,0'] = tile({ type });
    hexNeighbors({ q: 0, r: 0 }).forEach((n, i) => {
      const owner = i < owned ? 'A' : i < owned + enemy ? 'B' : null;
      tiles[hexKey(n)] = tile({ ...n, type: 'farmland', owner, troops: 1 });
    });
    return tiles;
  };

  it('counts only farmland owned by the same player', () => {
    expect(ownedFarmNeighbors(surrounded('city', 0), tile({}))).toBe(0);
    expect(ownedFarmNeighbors(surrounded('city', 3), tile({}))).toBe(3);
    expect(ownedFarmNeighbors(surrounded('city', 2, 4), tile({}))).toBe(2);
    expect(ownedFarmNeighbors(surrounded('city', 6), tile({}))).toBe(6);
    expect(ownedFarmNeighbors(surrounded('city', 6), tile({ owner: null }))).toBe(0);
  });

  it('does not count neighbors that are not farmland', () => {
    const tiles = surrounded('city', 6);
    tiles['1,0'] = tile({ q: 1, r: 0, type: 'village' });
    expect(ownedFarmNeighbors(tiles, tile({}))).toBe(5);
  });

  it('sets city cycles by farm count', () => {
    const ticks = [0, 1, 2, 3, 4, 5, 6].map((farms) => generationInterval(config, 'city', farms));
    expect(ticks).toEqual([8, 7, 6, 5, 4, 3, 2]);
  });

  it('sets village cycles one tick faster per farm', () => {
    const ticks = [0, 1, 2, 3, 4, 5, 6].map((farms) =>
      generationInterval(config, 'village', farms),
    );
    expect(ticks).toEqual([12, 11, 10, 9, 8, 7, 6]);
  });

  it('farmland never produces', () => {
    expect(generationInterval(config, 'farmland', 0)).toBeNull();
    const farm = tile({ type: 'farmland', progress: 0 });
    expect(stepTile(config, farm, 0)).toEqual({ troops: 5, progress: 0 });
  });

  it('scales the cycle with the match generation speed', () => {
    const fast = parseMatchConfig({ generationSpeedPercent: 200 });
    expect(generationInterval(fast, 'city', 0)).toBe(4);
    expect(generationInterval(fast, 'city', 6)).toBe(1);
  });

  it('stepTile advances, produces on the current cycle, and pauses at the cap', () => {
    expect(stepTile(config, tile({ progress: 1 }), 0)).toEqual({ troops: 5, progress: 2 });
    expect(stepTile(config, tile({ progress: 7 }), 0)).toEqual({ troops: 6, progress: 0 });
    expect(stepTile(config, tile({ progress: 1 }), 6)).toEqual({ troops: 6, progress: 0 });
    expect(stepTile(config, tile({ troops: 50, progress: 2 }), 6)).toEqual({
      troops: 50,
      progress: 2,
    });
  });

  it('a newly owned farm can complete a cycle early', () => {
    // Progress 6: with no farms the cycle is 8, with one farm it is 7.
    expect(stepTile(config, tile({ progress: 6 }), 0)).toEqual({ troops: 5, progress: 7 });
    expect(stepTile(config, tile({ progress: 6 }), 1)).toEqual({ troops: 6, progress: 0 });
  });

  it('decays neutral armies at the same flat rate for every type', () => {
    expect(decayInterval(config)).toBe(12);
    for (const type of ['farmland', 'village', 'city'] as const) {
      const neutral = tile({ type, owner: null, troops: 20, progress: 10 });
      expect(stepTile(config, neutral, 0).troops).toBe(20);
      expect(stepTile(config, { ...neutral, progress: 11 }, 0)).toEqual({
        troops: 19,
        progress: 0,
      });
    }
    expect(decayInterval(parseMatchConfig({ neutralDecayEveryTicks: 3 }))).toBe(3);
  });
});

describe('applyTickDiff', () => {
  /** A random game where clients only receive diffs must stay identical to the server. */
  it('reconstructs the server state from diffs for a whole random match', () => {
    // Fast production and low caps so production, pausing, battles and captures all happen.
    const fast = {
      generationSpeedPercent: 400,
      tileOverrides: {
        city: { generation: { cap: 12 } },
        village: { generation: { cap: 6 } },
      },
    };
    const { state: initial, config: matchConfig } = createSymmetricMatch({
      players: ['A', 'B'],
      seed: 21,
      radius: 5,
      config: fast,
    });
    const rng = createRng(77);

    let server = initial;
    const client: Record<string, Tile> = { ...initial.tiles };
    let captures = 0;
    for (let i = 0; i < 200 && server.winner === null; i++) {
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
  });
});
