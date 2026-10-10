import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hexKey, hexNeighbors, parseMatchConfig, type Hex, type Order } from '@hexxar/shared';
import { applyMessage, emptyGame, type GameView } from '../game.js';
import { LESSONS, TUTORIAL_TICK_MS } from './lessons.js';
import { LocalMatch } from './localMatch.js';
import { RIVAL, YOU, at, parseMap } from './maps.js';
import { TutorialRunner, type TutorialView } from './runner.js';

const move = (from: Hex, to: Hex): Order => ({ type: 'move', from, to });

describe('maps', () => {
  it('lays rows out with odd rows shifted half a tile, so neighbors in a row touch', () => {
    const state = parseMap(['Y.', '.E'], [YOU, RIVAL]);
    expect(Object.keys(state.tiles)).toHaveLength(4);
    expect(state.tiles['0,0']).toMatchObject({ type: 'city', owner: YOU, troops: 10 });
    // Row 1, column 1 is the rival's city; (0,0) and (1,0) are next to each other.
    expect(at(1, 0)).toEqual({ q: 1, r: 0 });
    expect(at(1, 1)).toEqual({ q: 1, r: 1 });
    expect(state.tiles['1,1']).toMatchObject({ owner: RIVAL });
  });
});

describe('LocalMatch', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const build = () => {
    const messages: string[] = [];
    const clocks: (number | null)[] = [];
    const state = parseMap(['Y..E'], [YOU, RIVAL]);
    const match = new LocalMatch({
      state,
      config: parseMatchConfig({ tickMs: 1000, fog: 'off' }),
      you: YOU,
      onMessage: (m) => messages.push(m.type),
      onClock: (t) => clocks.push(t),
    });
    return { match, messages, clocks };
  };

  it('is paused until told to run, and then ticks on its own', () => {
    const { match, messages } = build();
    match.start();
    vi.advanceTimersByTime(5000);
    expect(messages).toEqual(['snapshot']);
    match.setRunning(true);
    vi.advanceTimersByTime(1000);
    expect(messages).toEqual(['snapshot', 'tick']);
    vi.advanceTimersByTime(2000);
    expect(messages.filter((m) => m === 'tick')).toHaveLength(3);
    match.setRunning(false);
    vi.advanceTimersByTime(5000);
    expect(messages.filter((m) => m === 'tick')).toHaveLength(3);
    match.dispose();
  });

  it("queues the player's orders and runs one per tick", () => {
    const { match, messages } = build();
    match.handle({ type: 'order', order: move(at(0, 0), at(1, 0)) });
    match.handle({ type: 'order', order: move(at(1, 0), at(2, 0)) });
    expect(messages).toEqual(['queued', 'queued']);
    match.step();
    expect(match.queue).toHaveLength(1);
    expect(match.state.tiles['1,0']?.owner).toBe(YOU);
    match.step();
    expect(match.state.tiles['2,0']?.owner).toBe(YOU);
  });

  it('reports the clock to whoever is showing it', () => {
    const { match, clocks } = build();
    match.setRunning(true);
    match.setRunning(false);
    expect(clocks[0]).toBeGreaterThan(0);
    expect(clocks[1]).toBeNull();
  });
});

describe('the lessons', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** A tutorial running against a plain game view, with a "player" who can queue orders. */
  function harness() {
    const game: GameView = emptyGame();
    let view: TutorialView | null = null;
    let highlighted: readonly Hex[] = [];
    let pointer: readonly Hex[] = [];
    let left = false;
    const runner = new TutorialRunner({
      game,
      receive: (message) => void applyMessage(game, message),
      reset: () => {
        const names = game.names;
        Object.assign(game, emptyGame());
        game.names = names;
      },
      show: (next) => (view = next),
      highlight: (hexes) => (highlighted = hexes),
      pointer: (path) => (pointer = path),
      settled: () => true,
      leave: () => (left = true),
    });
    const advance = (ms: number) => vi.advanceTimersByTime(ms);
    /** Let time pass until the step's task is done, then press Next, as a player would. */
    const finishStep = () => {
      for (let i = 0; i < 400 && !view!.done; i++) advance(100);
      expect(view!.done).toBe(true);
      runner.next();
    };
    const order = (from: Hex, to: Hex) => runner.handle({ type: 'order', order: move(from, to) });
    return {
      runner,
      game,
      advance,
      finishStep,
      order,
      get view() {
        return view!;
      },
      get highlighted() {
        return highlighted;
      },
      get pointer() {
        return pointer;
      },
      get left() {
        return left;
      },
    };
  }

  type Harness = ReturnType<typeof harness>;

  /** What a player does at each step to finish it, for every lesson. */
  const solutions: Record<string, (h: Harness) => void> = {
    ticks(h) {
      h.runner.next();
      h.order(at(1, 1), at(2, 1));
      h.finishStep(); // the clock starts with the order, and the army marches in
      h.order(at(2, 1), at(3, 1));
      h.order(at(3, 1), at(4, 1));
      h.order(at(4, 1), at(5, 1));
      h.finishStep();
    },
    generation(h) {
      h.finishStep(); // the city makes a troop by itself
      const ring = hexNeighbors(at(2, 1));
      h.order(at(2, 1), ring[0]!);
      h.order(ring[0]!, ring[1]!);
      h.order(ring[1]!, ring[2]!);
      h.finishStep();
      h.runner.next();
      h.runner.next();
    },
    battles(h) {
      h.order(at(2, 2), at(3, 2));
      h.finishStep();
      // 5 attackers against a village that counts as 5: a tie, and the village is left empty.
      h.order(at(2, 1), at(3, 1));
      h.advance(5 * TUTORIAL_TICK_MS);
      expect(h.view.done).toBe(true);
      expect(h.game.tiles[hexKey(at(3, 1))]).toMatchObject({ owner: RIVAL, troops: 0 });
      h.runner.next();
      h.order(at(2, 1), at(3, 1));
      h.advance(5 * TUTORIAL_TICK_MS);
      expect(h.game.tiles[hexKey(at(3, 1))]).toMatchObject({ owner: YOU });
      h.finishStep();
      h.runner.next();
    },
    fog(h) {
      h.runner.next();
      h.order(at(1, 2), at(2, 2));
      h.order(at(2, 2), at(3, 2));
      h.order(at(3, 2), at(4, 2));
      h.order(at(4, 2), at(5, 2));
      h.finishStep();
    },
    interface(h) {
      h.runner.next(); // camera
      h.runner.next(); // pie
      h.runner.next(); // list
      h.order(at(2, 3), at(3, 3));
      h.order(at(3, 3), at(4, 3));
      h.finishStep();
      h.runner.next();
    },
  };

  it.each(LESSONS.map((lesson, index) => [lesson.id, index] as const))(
    'can be finished: %s',
    (id, index) => {
      const h = harness();
      h.runner.start(index);
      expect(h.view).toMatchObject({ lesson: index, step: 0 });
      solutions[id]!(h);
      if (index + 1 < LESSONS.length) expect(h.view).toMatchObject({ lesson: index + 1, step: 0 });
      else expect(h.view.finished).toBe(true);
      h.runner.exit();
    },
  );

  it('has a solution for every lesson', () => {
    expect(Object.keys(solutions).sort()).toEqual(LESSONS.map((lesson) => lesson.id).sort());
  });

  it('never moves on by itself, however long a finished task is left', () => {
    const h = harness();
    h.runner.start(0);
    h.runner.next();
    h.order(at(1, 1), at(2, 1));
    h.advance(20_000);
    expect(h.view).toMatchObject({ step: 1, done: true });
  });

  it('shows the pointer for a task, and stops showing it once the task is done', () => {
    const h = harness();
    h.runner.start(0);
    h.runner.next();
    expect(h.pointer).toEqual([at(1, 1), at(2, 1)]);
    h.order(at(1, 1), at(2, 1));
    h.advance(5 * TUTORIAL_TICK_MS);
    expect(h.view.done).toBe(true);
    expect(h.pointer).toEqual([]);
  });

  it('starts the clock for a task only once there is an order to run', () => {
    const h = harness();
    h.runner.start(0);
    h.runner.next();
    const before = h.game.tick;
    h.advance(10 * TUTORIAL_TICK_MS);
    expect(h.game.tick).toBe(before);
    h.order(at(1, 1), at(2, 1));
    h.advance(TUTORIAL_TICK_MS + 100);
    expect(h.game.tick).toBe(before + 1);
  });

  it('keeps the clock stopped while you read, except where a step wants it going', () => {
    const h = harness();
    h.runner.start(0);
    h.advance(3 * TUTORIAL_TICK_MS);
    expect(h.game.tick).toBeGreaterThan(1); // the first page lets you watch the dial
    h.runner.next();
    const before = h.game.tick;
    h.advance(10 * TUTORIAL_TICK_MS);
    expect(h.game.tick).toBe(before);
  });

  it('does not count a tick going by as an attack', () => {
    const h = harness();
    h.runner.start(2); // battles
    h.runner.next();
    h.advance(5 * TUTORIAL_TICK_MS);
    expect(h.view).toMatchObject({ step: 1, done: false });
  });

  it('says why a step failed, and waits for Reset', () => {
    const h = harness();
    h.runner.start(2); // battles
    h.runner.next();
    h.runner.next();
    // An order that does not go at the village.
    h.order(at(2, 1), at(2, 0));
    h.advance(TUTORIAL_TICK_MS + 100);
    expect(h.view.failure).toMatch(/whole army/);
    // Nothing resets by itself.
    h.advance(10_000);
    expect(h.view.failure).not.toBeNull();
    h.runner.retry();
    expect(h.view).toMatchObject({ lesson: 2, step: 2, failure: null });
    // The wrong order is gone, and the right one now works.
    h.order(at(2, 1), at(3, 1));
    h.finishStep();
    expect(h.game.tiles[hexKey(at(3, 1))]).toMatchObject({ owner: YOU });
  });

  it('can go back a step and jump between lessons', () => {
    const h = harness();
    h.runner.start(0);
    h.runner.next();
    h.runner.back();
    expect(h.view.step).toBe(0);
    h.runner.jump(3);
    expect(h.view).toMatchObject({ lesson: 3, step: 0 });
    expect(h.view.lessons).toHaveLength(LESSONS.length);
    // Back from the first page of a lesson is the last page of the one before.
    h.runner.back();
    expect(h.view).toMatchObject({ lesson: 2, step: LESSONS[2]!.steps.length - 1 });
  });

  it('starts every page from its own board, however the player got there', () => {
    const h = harness();
    h.runner.start(0);
    h.runner.next();
    h.runner.next(); // the route page: the first tile is already taken
    expect(h.game.tiles[hexKey(at(2, 1))]).toMatchObject({ owner: YOU, troops: 12 });
    h.order(at(2, 1), at(3, 1));
    h.advance(2 * TUTORIAL_TICK_MS);
    h.runner.jump(1);
    h.runner.back(); // the last page of lesson one again
    expect(h.game.tiles[hexKey(at(2, 1))]).toMatchObject({ owner: YOU, troops: 12 });
    expect(h.game.tiles[hexKey(at(3, 1))]?.owner ?? null).toBe(null);
  });

  it('keeps the clock running once a task is done', () => {
    const h = harness();
    h.runner.start(0);
    h.runner.next();
    h.order(at(1, 1), at(2, 1));
    h.advance(5 * TUTORIAL_TICK_MS);
    expect(h.view.done).toBe(true);
    const tick = h.game.tick;
    h.advance(3 * TUTORIAL_TICK_MS);
    expect(h.game.tick).toBeGreaterThan(tick);
  });
});
