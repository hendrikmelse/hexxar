import { describe, expect, it } from 'vitest';
import { parseMatchConfig } from './config.js';
import { hexKey } from './hex.js';
import type { Order, OrdersByPlayer } from './orders.js';
import { executedMoves, resolveTick, surrender } from './resolve.js';
import type { GameState, PlayerId, Tile } from './state.js';
import type { TileTypeId } from './tiles.js';

const config = parseMatchConfig({});

type Spec = { type?: TileTypeId; owner?: PlayerId | null; troops: number; progress?: number };

/** Tiles laid out in a row along q: (0,0), (1,0), (2,0), ... */
function row(specs: Spec[], players: PlayerId[] = ['A', 'B', 'C']): GameState {
  const tiles: Record<string, Tile> = {};
  specs.forEach((spec, q) => {
    tiles[hexKey({ q, r: 0 })] = {
      q,
      r: 0,
      type: spec.type ?? 'farmland',
      owner: spec.owner ?? null,
      troops: spec.troops,
      progress: spec.progress ?? 0,
    };
  });
  return { tick: 0, players, eliminated: [], winner: null, tiles };
}

const move = (from: number, to: number): Order => ({
  type: 'move',
  from: { q: from, r: 0 },
  to: { q: to, r: 0 },
});

const at = (state: GameState, q: number): Tile => state.tiles[hexKey({ q, r: 0 })]!;

// Tiles start with zero generation progress, and cities take at least 2 ticks per troop, so
// single steps in the tests below never trigger generation by accident.
const step = (state: GameState, orders: OrdersByPlayer) => resolveTick(state, orders, config);

describe('movement', () => {
  it('moves all but one troop and leaves one behind', () => {
    const s = step(row([{ owner: 'A', troops: 5 }, { troops: 0 }]), { A: move(0, 1) });
    expect(at(s, 0)).toMatchObject({ owner: 'A', troops: 1 });
    expect(at(s, 1)).toMatchObject({ owner: 'A', troops: 4 });
  });

  it('drops invalid orders', () => {
    const start = row([{ owner: 'A', troops: 1 }, { owner: 'B', troops: 5 }, { troops: 0 }]);
    const s = step(start, {
      A: move(0, 1), // only 1 troop
      B: move(1, 0), // fine
      C: move(1, 2), // not C's tile
    });
    expect(at(s, 0)).toMatchObject({ owner: 'B', troops: 3 }); // B's 4 attackers beat A's 1
    expect(at(s, 2).troops).toBe(0);
    expect(at(step(start, { A: move(0, 2) }), 0).troops).toBe(1); // not adjacent
  });

  it('does not mutate the input state', () => {
    const start = row([{ owner: 'A', troops: 5 }, { troops: 0 }]);
    const snapshot = JSON.stringify(start);
    step(start, { A: move(0, 1) });
    expect(JSON.stringify(start)).toBe(snapshot);
  });

  it('only meets the troop left behind when attacking a departing army', () => {
    const start = row([{ owner: 'A', troops: 5 }, { owner: 'B', troops: 6 }, { troops: 0 }]);
    const s = step(start, { A: move(0, 1), B: move(1, 2) });
    // B's army leaves 1 troop behind; A's 4 attackers win with 3.
    expect(at(s, 1)).toMatchObject({ owner: 'A', troops: 3 });
    expect(at(s, 2)).toMatchObject({ owner: 'B', troops: 5 });
  });
});

describe('reinforcement', () => {
  it('merges arriving troops into the friendly army', () => {
    const s = step(
      row([
        { owner: 'A', troops: 5 },
        { owner: 'A', troops: 6 },
      ]),
      { A: move(0, 1) },
    );
    expect(at(s, 1).troops).toBe(10);
  });

  it('reinforces a tile in the same tick it is attacked', () => {
    // B attacks tile 1 with 4 troops; A reinforces tile 1 from tile 2.
    const start = row([
      { owner: 'B', troops: 5 },
      { owner: 'A', troops: 3 },
      { owner: 'A', troops: 6 },
    ]);
    const s = step(start, { B: move(0, 1), A: move(2, 1) });
    // Defender 3 + 5 = 8 vs attacker 4 => A keeps 4.
    expect(at(s, 1)).toMatchObject({ owner: 'A', troops: 4 });
  });
});

describe('battles', () => {
  it('captures a neutral tile when strong enough', () => {
    const s = step(row([{ owner: 'A', troops: 6 }, { troops: 2 }]), { A: move(0, 1) });
    expect(at(s, 1)).toMatchObject({ owner: 'A', troops: 3 });
  });

  it('fails to capture when outmatched', () => {
    const s = step(
      row([
        { owner: 'A', troops: 3 },
        { troops: 8, type: 'farmland' },
      ]),
      {
        A: move(0, 1),
      },
    );
    expect(at(s, 1)).toMatchObject({ owner: null, troops: 6 });
  });

  it('leaves an empty tile and keeps the owner on a tie', () => {
    // B's city keeps B in the game, so the emptied tile is still B's.
    const s = step(
      row([
        { owner: 'A', troops: 5 },
        { owner: 'B', troops: 4 },
        { owner: 'B', troops: 1, type: 'city' },
      ]),
      { A: move(0, 1) },
    );
    expect(at(s, 1)).toMatchObject({ owner: 'B', troops: 0 });
  });

  it('gives defenders their tile bonus', () => {
    // Attacker 4 vs city defender 3 (strength 450): the defender holds, losing floor(400/150) = 2.
    const city = row([
      { owner: 'A', troops: 5 },
      { owner: 'B', troops: 3, type: 'city' },
    ]);
    expect(at(step(city, { A: move(0, 1) }), 1)).toMatchObject({ owner: 'B', troops: 1 });
    // Same troops on farmland: attacker 4 vs 3 => attacker takes it with 1. (A's city, off to the
    // side, keeps A in the game, and B's city keeps B in.)
    const farm = row([
      { owner: 'A', troops: 5 },
      { owner: 'B', troops: 3 },
      { owner: 'A', troops: 1, type: 'city' },
      { owner: 'B', troops: 1, type: 'city' },
    ]);
    expect(at(step(farm, { A: move(0, 1) }), 1)).toMatchObject({ owner: 'A', troops: 1 });
  });

  it('defender losses round down', () => {
    // Defender 10 * 150% = 1500 vs attacker 4 * 100 = 400: the defender loses floor(400/150) = 2.
    const start = row([
      { owner: 'A', troops: 5 },
      { owner: 'B', troops: 10, type: 'city' },
    ]);
    expect(at(step(start, { A: move(0, 1) }), 1)).toMatchObject({ owner: 'B', troops: 8 });
  });

  it('attacker losses round up, so a narrow win can leave nobody to take the tile', () => {
    // Attacker 4 (400) beats village defender 3 (375), but pays ceil(375/100) = 4 troops.
    const start = row([
      { owner: 'A', troops: 5 },
      { owner: 'B', troops: 3, type: 'village' },
    ]);
    expect(at(step(start, { A: move(0, 1) }), 1)).toMatchObject({ owner: 'B', troops: 0 });
  });

  it('a stream of one-man armies cannot wear down a city', () => {
    // Each 1-troop attack faces 15 strength, costs the attacker its troop and kills nothing.
    const slow = parseMatchConfig({ generationSpeedPercent: 10 });
    let state = row(
      [
        { owner: 'A', troops: 2 },
        { owner: 'B', troops: 10, type: 'city' },
      ],
      ['A', 'B'],
    );
    for (let i = 0; i < 10; i++) {
      const refill = { ...at(state, 0), troops: 2 };
      state = resolveTick(
        { ...state, tiles: { ...state.tiles, [hexKey({ q: 0, r: 0 })]: refill } },
        { A: move(0, 1) },
        slow,
      );
    }
    expect(at(state, 1)).toMatchObject({ owner: 'B', troops: 10 });
  });

  it('three-way: the strongest fights the second and the rest are removed', () => {
    // A at 0 and C at 2 both attack B's... use neutral tile 1 with garrison 1.
    const start = row([
      { owner: 'A', troops: 8 }, // sends 7
      { troops: 1 },
      { owner: 'B', troops: 5 }, // sends 4
    ]);
    const s = step(start, { A: move(0, 1), B: move(2, 1) });
    expect(at(s, 1)).toMatchObject({ owner: 'A', troops: 3 });
  });

  it('does not depend on the order orders are provided in', () => {
    const start = row([{ owner: 'A', troops: 8 }, { troops: 1 }, { owner: 'B', troops: 5 }]);
    const one = step(start, { A: move(0, 1), B: move(2, 1) });
    const two = step(start, { B: move(2, 1), A: move(0, 1) });
    expect(one).toEqual(two);
  });
});

describe('generation', () => {
  // A single city has no farm neighbors, so its cycle is the base 8 ticks.
  const city = (troops: number, progress: number, owner: string | null = 'A') =>
    row([{ owner, troops, type: 'city', progress }], ['A']);

  it('adds a troop when a producer completes its cycle, then restarts the cycle', () => {
    expect(at(step(city(5, 6), {}), 0)).toMatchObject({ troops: 5, progress: 7 });
    expect(at(step(city(5, 7), {}), 0)).toMatchObject({ troops: 6, progress: 0 });
  });

  it('keeps each producer on its own schedule', () => {
    // Two cities with neutral farmland between them: no farm bonus for either.
    const start = row(
      [
        { owner: 'A', troops: 5, type: 'city', progress: 7 },
        { troops: 1 },
        { troops: 1 },
        { owner: 'A', troops: 5, type: 'city', progress: 6 },
      ],
      ['A'],
    );
    const one = step(start, {});
    expect(at(one, 0)).toMatchObject({ troops: 6, progress: 0 });
    expect(at(one, 3)).toMatchObject({ troops: 5, progress: 7 });
    const two = step(one, {});
    expect(at(two, 0)).toMatchObject({ troops: 6, progress: 1 });
    expect(at(two, 3)).toMatchObject({ troops: 6, progress: 0 });
  });

  it('owned farmland speeds up the neighboring city', () => {
    // City with one owned farm next to it: cycle 7 instead of 8.
    const withFarm = row(
      [
        { owner: 'A', troops: 5, type: 'city', progress: 6 },
        { owner: 'A', troops: 1 },
      ],
      ['A'],
    );
    expect(at(step(withFarm, {}), 0)).toMatchObject({ troops: 6, progress: 0 });
    // The same farm owned by someone else, or by nobody, does not count.
    for (const owner of [null, 'B']) {
      const without = row(
        [
          { owner: 'A', troops: 5, type: 'city', progress: 6 },
          { owner, troops: 1 },
        ],
        ['A', 'B'],
      );
      expect(at(step(without, {}), 0)).toMatchObject({ troops: 5, progress: 7 });
    }
  });

  it('uses the farm count from before the tick', () => {
    // A captures the farm this tick; the city only benefits from next tick on.
    const start = row(
      [
        { owner: 'A', troops: 5, type: 'city', progress: 6 },
        { troops: 1 },
        { owner: 'A', troops: 5 },
      ],
      ['A'],
    );
    const s = step(start, { A: move(2, 1) });
    expect(at(s, 1).owner).toBe('A');
    expect(at(s, 0)).toMatchObject({ troops: 5, progress: 7 });
    expect(at(step(s, {}), 0)).toMatchObject({ troops: 6, progress: 0 });
  });

  it('owned farmland produces nothing', () => {
    const start = row([{ owner: 'A', troops: 3, type: 'farmland', progress: 0 }], ['A']);
    let s = start;
    for (let i = 0; i < 60; i++) s = step(s, {});
    expect(at(s, 0)).toMatchObject({ troops: 3, progress: 0 });
  });

  it('scales with the match generation speed', () => {
    const fast = parseMatchConfig({ generationSpeedPercent: 300 });
    expect(at(resolveTick(city(5, 2), {}, fast), 0).troops).toBe(6); // cycle 3
  });

  it('pauses at the cap and keeps its progress', () => {
    expect(at(step(city(49, 7), {}), 0)).toMatchObject({ troops: 50, progress: 0 });
    expect(at(step(city(50, 3), {}), 0)).toMatchObject({ troops: 50, progress: 3 });
    // Armies can exceed the cap through reinforcement; they just stop growing.
    expect(at(step(city(60, 1), {}), 0)).toMatchObject({ troops: 60, progress: 1 });
  });

  it('a full producer only loses a tick when its army passes through, not its progress', () => {
    const start = row(
      [
        { owner: 'A', troops: 50, type: 'city', progress: 3 },
        { owner: 'A', troops: 1 },
      ],
      ['A'],
    );
    const s = step(start, { A: move(0, 1) });
    // The city was full, so it paused at 3; it left 1 troop behind and resumes next tick.
    expect(at(s, 0)).toMatchObject({ troops: 1, progress: 3 });
    expect(at(step(s, {}), 0)).toMatchObject({ troops: 1, progress: 4 });
  });

  it('starts a captured tile at zero progress', () => {
    const start = row([
      { owner: 'A', troops: 9 },
      { owner: 'B', troops: 1, type: 'city', progress: 4 },
      { troops: 1, progress: 0 },
    ]);
    const s = step(start, { A: move(0, 1) });
    expect(at(s, 1)).toMatchObject({ owner: 'A', progress: 0 });
  });

  it('keeps progress when the owner holds a tile through an attack', () => {
    const start = row([
      { owner: 'A', troops: 3, type: 'city', progress: 2 },
      { owner: 'B', troops: 3 },
    ]);
    const s = step(start, { B: move(1, 0) }); // 2 attackers vs 3 defenders at 150%
    expect(at(s, 0)).toMatchObject({ owner: 'A', progress: 3 });
  });

  it('can be overridden per match', () => {
    const custom = parseMatchConfig({
      tileOverrides: { city: { generation: { everyTicks: [1, 1, 1, 1, 1, 1, 1], cap: 7 } } },
    });
    expect(at(resolveTick(city(5, 0), {}, custom), 0).troops).toBe(6);
    expect(at(resolveTick(city(7, 0), {}, custom), 0).troops).toBe(7);
  });

  it('never generates on neutral tiles', () => {
    expect(at(step(city(10, 2, null), {}), 0).troops).toBe(10);
  });
});

describe('neutral armies', () => {
  const neutral = (troops: number, progress: number, type: TileTypeId = 'city') =>
    row([{ troops, type, progress }]);

  it('shrinks toward the base garrison, one troop per 12 ticks, for every tile type', () => {
    for (const type of ['farmland', 'village', 'city'] as const) {
      expect(at(step(neutral(14, 10, type), {}), 0)).toMatchObject({ troops: 14, progress: 11 });
      expect(at(step(neutral(14, 11, type), {}), 0)).toMatchObject({ troops: 13, progress: 0 });
    }
  });

  it('stops shrinking at the base garrison and does not regrow below it', () => {
    expect(at(step(neutral(10, 5), {}), 0)).toMatchObject({ troops: 10, progress: 0 });
    expect(at(step(neutral(3, 5), {}), 0)).toMatchObject({ troops: 3, progress: 0 });
  });

  it('decay rate is configurable', () => {
    const fast = parseMatchConfig({ neutralDecayEveryTicks: 3 });
    expect(at(resolveTick(neutral(14, 2), {}, fast), 0).troops).toBe(13);
  });

  it('a surrendered army defends but decays back to the default', () => {
    const start = row([{ owner: 'B', troops: 14, type: 'city', progress: 2 }], ['A', 'B']);
    let s = surrender(start, 'B');
    expect(at(s, 0)).toMatchObject({ owner: null, troops: 14, progress: 0 });
    for (let i = 0; i < 12; i++) s = step(s, {});
    expect(at(s, 0).troops).toBe(13);
  });
});

describe('generation timing', () => {
  it('a troop generated this tick fights in a battle on that tick', () => {
    const start = row([
      { owner: 'A', troops: 4, type: 'city', progress: 7 }, // produces this tick: 4 -> 5
      { owner: 'B', troops: 6 },
    ]);
    // B sends 5 (500) against 5 * 150% = 750: A loses floor(500/150) = 3 and keeps 2.
    expect(at(step(start, { B: move(1, 0) }), 0)).toMatchObject({ owner: 'A', troops: 2 });
    // Without the new troop A would have 4 (600) and keep only 1.
    const early = row([
      { owner: 'A', troops: 4, type: 'city', progress: 0 },
      { owner: 'B', troops: 6 },
    ]);
    expect(at(step(early, { B: move(1, 0) }), 0)).toMatchObject({ owner: 'A', troops: 1 });
  });

  it('a troop generated this tick can make an order valid and be moved', () => {
    const start = row([{ owner: 'A', troops: 1, type: 'city', progress: 7 }, { troops: 0 }]);
    const s = step(start, { A: move(0, 1) }); // produces to 2, then sends 1
    expect(at(s, 0)).toMatchObject({ owner: 'A', troops: 1 });
    expect(at(s, 1)).toMatchObject({ owner: 'A', troops: 1 });
  });
});

describe('armies that swap places', () => {
  it('meet halfway, and the survivors carry on to the tile they were sent to', () => {
    // A sends 10, B sends 6: A wins with 4, which then attacks B's tile (one troop left).
    const start = row(
      [
        { owner: 'A', troops: 11 },
        { owner: 'B', troops: 7 },
      ],
      ['A', 'B'],
    );
    const s = step(start, { A: move(0, 1), B: move(1, 0) });
    expect(at(s, 0)).toMatchObject({ owner: 'A', troops: 1 });
    // 4 attackers beat the single defender and lose one troop doing it.
    expect(at(s, 1)).toMatchObject({ owner: 'A', troops: 3 });
    expect(s.eliminated).toEqual(['B']);
  });

  it('fight without defensive bonuses, but the survivors do meet the target tile bonus', () => {
    // B's tile is a city (150% defense). The clash itself ignores that.
    const start = row(
      [
        { owner: 'A', troops: 11 },
        { owner: 'B', troops: 7, type: 'city' },
      ],
      ['A', 'B'],
    );
    const s = step(start, { A: move(0, 1), B: move(1, 0) });
    // 10 vs 6 leaves 4. Then 4 attack the city's 1 troop (strength 150): the attackers lose 2.
    expect(at(s, 1)).toMatchObject({ owner: 'A', troops: 2 });
  });

  it('wipe each other out on a tie, leaving both tiles with their one troop', () => {
    const start = row(
      [
        { owner: 'A', troops: 5, type: 'city' },
        { owner: 'B', troops: 5, type: 'city' },
      ],
      ['A', 'B'],
    );
    const s = step(start, { A: move(0, 1), B: move(1, 0) });
    expect(at(s, 0)).toMatchObject({ owner: 'A', troops: 1 });
    expect(at(s, 1)).toMatchObject({ owner: 'B', troops: 1 });
  });

  it('reports the clash for animation, leaving ordinary moves alone', () => {
    const start = row(
      [
        { owner: 'A', troops: 11 },
        { owner: 'B', troops: 7 },
        { owner: 'C', troops: 6 },
      ],
      ['A', 'B', 'C'],
    );
    const moves = executedMoves(start, { A: move(0, 1), B: move(1, 0), C: move(2, 1) }, config);
    const byPlayer = Object.fromEntries(moves.map((m) => [m.player, m]));
    expect(byPlayer.A).toMatchObject({ troops: 10, clash: { survivors: 4 } });
    expect(byPlayer.B).toMatchObject({ troops: 6, clash: { survivors: 0 } });
    expect(byPlayer.C?.clash).toBeUndefined();
  });
});

describe('winning', () => {
  it('eliminates a player who loses their last tile and crowns the survivor', () => {
    const start = row(
      [
        { owner: 'A', troops: 9 },
        { owner: 'B', troops: 1 },
      ],
      ['A', 'B'],
    );
    const s = step(start, { A: move(0, 1) });
    expect(s.eliminated).toEqual(['B']);
    expect(s.winner).toBe('A');
  });

  it('beats a player with no producers left and only one-troop farms, and frees those farms', () => {
    const start = row(
      [
        { owner: 'A', troops: 9 },
        { owner: 'B', troops: 1 },
        { owner: 'B', troops: 1 },
      ],
      ['A', 'B'],
    );
    const s = step(start, {});
    expect(s.eliminated).toEqual(['B']);
    expect(s.winner).toBe('A');
    expect(at(s, 1)).toMatchObject({ owner: null, troops: 1 });
    expect(at(s, 2)).toMatchObject({ owner: null, troops: 1 });
  });

  it('keeps a player in the game while they own a producer, or an army that can still move', () => {
    const withCity = row(
      [
        { owner: 'A', troops: 9 },
        { owner: 'B', troops: 1, type: 'city' },
      ],
      ['A', 'B'],
    );
    expect(step(withCity, {})).toMatchObject({ eliminated: [], winner: null });
    const withArmy = row(
      [
        { owner: 'A', troops: 9 },
        { owner: 'B', troops: 2 },
      ],
      ['A', 'B'],
    );
    expect(step(withArmy, {})).toMatchObject({ eliminated: [], winner: null });
  });

  it('stops processing once the match is over', () => {
    const start = row(
      [
        { owner: 'A', troops: 9 },
        { owner: 'B', troops: 1 },
      ],
      ['A', 'B'],
    );
    const over = step(start, { A: move(0, 1) });
    expect(step(over, { A: move(1, 0) })).toBe(over);
  });

  it('turns a surrendering player tiles neutral', () => {
    const start = row(
      [
        { owner: 'A', troops: 9 },
        { owner: 'B', troops: 4 },
      ],
      ['A', 'B'],
    );
    const s = surrender(start, 'B');
    expect(at(s, 1)).toMatchObject({ owner: null, troops: 4 });
    expect(s.eliminated).toEqual(['B']);
    expect(s.winner).toBe('A');
  });

  it('does not declare a winner in a solo match', () => {
    const solo = row([{ owner: 'A', troops: 3 }], ['A']);
    expect(step(solo, {}).winner).toBeNull();
  });
});
