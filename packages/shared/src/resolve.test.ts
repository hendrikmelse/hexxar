import { describe, expect, it } from 'vitest';
import { parseMatchConfig } from './config.js';
import { hexKey } from './hex.js';
import type { Order, OrdersByPlayer } from './orders.js';
import { resolveTick, surrender } from './resolve.js';
import type { GameState, PlayerId, Tile } from './state.js';
import type { TileTypeId } from './tiles.js';

const config = parseMatchConfig({});

type Spec = { type?: TileTypeId; owner?: PlayerId | null; troops: number };

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

// Generation would muddy exact troop counts, so most tests start at tick 1 of a
// long interval; farmland generates every 8 ticks, so tick 1 never triggers it.
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
    expect(step(start, { A: move(0, 2) }).tiles).toEqual(start.tiles); // not adjacent
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
    const s = step(
      row([
        { owner: 'A', troops: 5 },
        { owner: 'B', troops: 4 },
      ]),
      { A: move(0, 1) },
    );
    expect(at(s, 1)).toMatchObject({ owner: 'B', troops: 0 });
  });

  it('gives defenders their tile bonus', () => {
    // Attacker 4 vs city defender 3 * 150% = 4.5 => defender holds with floor(0.5 / 1.5) = 0.
    const city = row([
      { owner: 'A', troops: 5 },
      { owner: 'B', troops: 3, type: 'city' },
    ]);
    expect(at(step(city, { A: move(0, 1) }), 1)).toMatchObject({ owner: 'B', troops: 0 });
    // Same troops on farmland: attacker 4 vs 3 => attacker takes it with 1.
    const farm = row([
      { owner: 'A', troops: 5 },
      { owner: 'B', troops: 3 },
    ]);
    expect(at(step(farm, { A: move(0, 1) }), 1)).toMatchObject({ owner: 'A', troops: 1 });
  });

  it('keeps the survivors scaled back down when a defender wins', () => {
    // Defender 10 * 150% = 1500 vs attacker 4 * 100 = 400 => 1100 / 150 = 7 troops.
    const start = row([
      { owner: 'A', troops: 5 },
      { owner: 'B', troops: 10, type: 'city' },
    ]);
    expect(at(step(start, { A: move(0, 1) }), 1)).toMatchObject({ owner: 'B', troops: 7 });
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

  it('lets armies swap places without fighting each other', () => {
    const start = row([
      { owner: 'A', troops: 5 },
      { owner: 'B', troops: 5 },
    ]);
    const s = step(start, { A: move(0, 1), B: move(1, 0) });
    // Each side attacks the other's tile, which still holds 1 troop.
    expect(at(s, 0)).toMatchObject({ owner: 'B', troops: 3 });
    expect(at(s, 1)).toMatchObject({ owner: 'A', troops: 3 });
  });
});

describe('generation', () => {
  const city = (troops: number, tick: number, owner: string | null = 'A') => ({
    ...row([{ owner, troops, type: 'city' }]),
    tick,
  });

  it('adds a troop to owned tiles every interval', () => {
    // Cities generate every 3 ticks.
    expect(at(step(city(5, 2), {}), 0).troops).toBe(6); // next tick is 3
    expect(at(step(city(5, 3), {}), 0).troops).toBe(5); // next tick is 4
  });

  it('scales with the match generation speed', () => {
    const fast = parseMatchConfig({ generationSpeedPercent: 300 });
    expect(at(resolveTick(city(5, 0), {}, fast), 0).troops).toBe(6); // interval 1
  });

  it('stops generating at the tile cap', () => {
    expect(at(step(city(49, 2), {}), 0).troops).toBe(50);
    expect(at(step(city(50, 2), {}), 0).troops).toBe(50);
    // Armies can exceed the cap through reinforcement; they just stop growing.
    expect(at(step(city(60, 2), {}), 0).troops).toBe(60);
  });

  it('uses the per-type defaults', () => {
    const start = row([
      { owner: 'A', troops: 1, type: 'farmland' },
      { owner: 'A', troops: 1, type: 'village' },
    ]);
    const after = (tick: number) => step({ ...start, tick }, {});
    expect(at(after(22), 0).troops).toBe(1); // next tick 23: nothing
    expect(at(after(22), 1).troops).toBe(1);
    expect(at(after(23), 0).troops).toBe(2); // next tick 24: farmland (every 24)
    expect(at(after(7), 1).troops).toBe(2); // next tick 8: village (every 8)
    expect(at(after(7), 0).troops).toBe(1);
  });

  it('can be overridden per match', () => {
    const custom = parseMatchConfig({
      tileOverrides: { city: { generation: { everyTicks: 1, cap: 7 } } },
    });
    expect(at(resolveTick(city(5, 0), {}, custom), 0).troops).toBe(6);
    expect(at(resolveTick(city(7, 0), {}, custom), 0).troops).toBe(7);
  });

  it('never generates on neutral tiles', () => {
    expect(at(step(city(10, 2, null), {}), 0).troops).toBe(10);
  });
});

describe('neutral armies', () => {
  const neutralCity = (troops: number, tick: number) => ({
    ...row([{ troops, type: 'city' }]),
    tick,
  });

  it('shrinks toward the base garrison, one troop at a time', () => {
    // Decay every 6 ticks by default; next tick 6.
    expect(at(step(neutralCity(14, 5), {}), 0).troops).toBe(13);
    expect(at(step(neutralCity(14, 4), {}), 0).troops).toBe(14);
  });

  it('stops shrinking at the base garrison and does not regrow below it', () => {
    expect(at(step(neutralCity(10, 5), {}), 0).troops).toBe(10);
    expect(at(step(neutralCity(3, 5), {}), 0).troops).toBe(3);
  });

  it('decays at half the generation rate of its tile type', () => {
    const farm = (tick: number) => ({ ...row([{ troops: 5, type: 'farmland' }]), tick });
    expect(at(step(farm(46), {}), 0).troops).toBe(5); // next tick 47
    expect(at(step(farm(47), {}), 0).troops).toBe(4); // next tick 48 = 2 * 24
    const village = (tick: number) => ({ ...row([{ troops: 9, type: 'village' }]), tick });
    expect(at(step(village(15), {}), 0).troops).toBe(8); // 2 * 8
  });

  it('decay rate is configurable', () => {
    const fast = parseMatchConfig({ neutralDecayRatePercent: 100 });
    const start = { ...row([{ troops: 14, type: 'city' }]), tick: 2 };
    expect(at(resolveTick(start, {}, fast), 0).troops).toBe(13); // every 3 ticks
  });

  it('a surrendered army defends but decays back to the default', () => {
    const start = { ...row([{ owner: 'B', troops: 14, type: 'city' }], ['A', 'B']), tick: 5 };
    const s = surrender(start, 'B');
    expect(at(s, 0)).toMatchObject({ owner: null, troops: 14 });
    expect(at(step(s, {}), 0).troops).toBe(13);
  });
});

describe('generation timing', () => {
  it('a troop generated this tick fights in a battle on that tick', () => {
    // City A at tick 2 generates on tick 3: 4 -> 5 troops (x150%) beats the 7-troop attack...
    const start = {
      ...row([
        { owner: 'A', troops: 4, type: 'city' },
        { owner: 'B', troops: 6 },
      ]),
      tick: 2,
    };
    // B sends 5 (strength 500). A defends with 4+1 = 5 * 150 = 750 => A holds with floor(250 / 150) = 1.
    const s = step(start, { B: move(1, 0) });
    expect(at(s, 0)).toMatchObject({ owner: 'A', troops: 1 });
    // Without the generated troop A would have 600 vs 500 => 0 survivors.
    const before = step({ ...start, tick: 3 }, { B: move(1, 0) });
    expect(at(before, 0)).toMatchObject({ owner: 'A', troops: 0 });
  });

  it('a troop generated this tick can make an order valid and be moved', () => {
    const start = { ...row([{ owner: 'A', troops: 1, type: 'city' }, { troops: 0 }]), tick: 2 };
    const s = step(start, { A: move(0, 1) }); // generates to 2, then sends 1
    expect(at(s, 0)).toMatchObject({ owner: 'A', troops: 1 });
    expect(at(s, 1)).toMatchObject({ owner: 'A', troops: 1 });
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
