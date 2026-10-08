import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hexKey, parseMatchConfig, type Hex, type Order } from '@hexxar/shared';
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
      leave: () => (left = true),
    });
    const advance = (ms: number) => vi.advanceTimersByTime(ms);
    /** Let time pass until the guide has moved to a later step (or the condition holds). */
    const untilStep = (step: number, lesson = view!.lesson) => {
      for (let i = 0; i < 400 && !(view!.lesson === lesson && view!.step >= step); i++)
        advance(100);
      expect(view).toMatchObject({ lesson, step });
    };
    const order = (from: Hex, to: Hex) => runner.handle({ type: 'order', order: move(from, to) });
    return {
      runner,
      game,
      advance,
      untilStep,
      order,
      get view() {
        return view!;
      },
      get highlighted() {
        return highlighted;
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
      h.order(at(0, 1), at(1, 1));
      h.untilStep(2);
      h.untilStep(3);
      h.order(at(1, 1), at(2, 1));
      h.order(at(2, 1), at(3, 1));
      h.order(at(3, 1), at(4, 1));
      h.untilStep(4);
      h.runner.next();
    },
    generation(h) {
      h.untilStep(1); // the city makes a troop by itself
      h.order(at(3, 2), at(4, 2));
      h.untilStep(2);
      h.runner.next();
      h.runner.next();
    },
    march(h) {
      h.order(at(0, 1), at(1, 1));
      h.untilStep(1);
      h.order(at(1, 1), at(2, 1));
      h.order(at(2, 1), at(3, 1));
      h.untilStep(2);
      h.order(at(3, 1), at(2, 1));
      h.untilStep(3);
      h.runner.next();
    },
    battles(h) {
      h.order(at(0, 2), at(1, 2));
      h.untilStep(1);
      h.runner.next();
      // Too small an army: the village holds, and the lesson moves on to the bigger one.
      h.order(at(3, 2), at(4, 2));
      h.untilStep(3);
      expect(h.game.tiles[hexKey(at(4, 2))]).toMatchObject({ owner: null });
      h.order(at(3, 2), at(4, 2));
      h.untilStep(4);
      expect(h.game.tiles[hexKey(at(4, 2))]).toMatchObject({ owner: YOU });
      h.runner.next();
    },
    meeting(h) {
      h.runner.next();
      h.order(at(1, 1), at(2, 1));
      h.untilStep(2);
      h.untilStep(3);
      // Their 6 and your 9 met halfway; the 3 left over took the city.
      expect(h.game.tiles['2,1']).toMatchObject({ owner: YOU });
      h.runner.next();
    },
    fog(h) {
      h.runner.next();
      h.runner.next();
      h.order(at(1, 2), at(2, 2));
      h.order(at(2, 2), at(3, 2));
      h.order(at(3, 2), at(4, 2));
      h.untilStep(3);
      h.runner.next();
    },
    scoreboard(h) {
      h.runner.next();
      h.runner.next();
      h.order(at(1, 2), at(2, 2));
      h.untilStep(3);
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
      else expect(h.left).toBe(true);
      h.runner.exit();
    },
  );

  it('has a solution for every lesson', () => {
    expect(Object.keys(solutions).sort()).toEqual(LESSONS.map((lesson) => lesson.id).sort());
  });

  it('points out tiles and parts of the screen, and keeps the clock stopped while you read', () => {
    const h = harness();
    h.runner.start(0);
    expect(h.view.hud).toBe('timer');
    h.advance(10 * TUTORIAL_TICK_MS);
    expect(h.game.tick).toBe(1); // nothing has happened
    h.runner.next();
    expect(h.highlighted.length).toBeGreaterThan(0);
  });

  it('starts a failed step over, and says why', () => {
    const h = harness();
    h.runner.start(4); // armies that meet
    h.runner.next();
    // An order that does not meet the rival's army.
    h.order(at(1, 1), at(0, 1));
    h.untilStep(2);
    h.advance(TUTORIAL_TICK_MS + 100);
    expect(h.view.failure).toMatch(/meet it/);
    h.advance(4000);
    expect(h.view).toMatchObject({ lesson: 4, step: 1, failure: null });
    // The wrong order is gone, and the right one now works.
    expect(h.runner.active).toBe(true);
    h.order(at(1, 1), at(2, 1));
    h.untilStep(3);
    expect(h.game.tiles['2,1']).toMatchObject({ owner: YOU });
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
  });
});
