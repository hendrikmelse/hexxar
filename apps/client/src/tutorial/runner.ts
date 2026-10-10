import {
  hexKey,
  type ClientMessage,
  type GameState,
  type Hex,
  type ServerMessage,
} from '@hexxar/shared';
import type { GameView } from '../game.js';
import { LESSONS, tutorialConfig, type Ctx, type HudTarget, type Lesson } from './lessons.js';
import { LocalMatch } from './localMatch.js';
import { YOU, parseMap } from './maps.js';

/** What the screen needs to show about the tutorial. */
export interface TutorialView {
  readonly lessons: readonly string[];
  readonly lesson: number;
  readonly step: number;
  readonly steps: number;
  readonly title: string;
  readonly text: string;
  /** The step's task is done (or it has none): the player can go on. */
  readonly done: boolean;
  /** Whether the step has a task at all. */
  readonly hasTask: boolean;
  /** Something went wrong and the player is being sent back to try again. */
  readonly failure: string | null;
  readonly hud: HudTarget | null;
  /** Whether the part of the screen being pointed at gets an outline as well as an arrow. */
  readonly hudOutline: boolean;
  readonly last: boolean;
  /** The whole tutorial is over: time for the congratulations. */
  readonly finished: boolean;
}

/** What the runner needs from the app around it. */
export interface TutorialEnv {
  /** The match as the player sees it. */
  readonly game: GameView;
  /** Feed a message from the (local) server to the game view and the screen. */
  receive(message: ServerMessage): void;
  /** Wipe the previous match off the screen. */
  reset(): void;
  show(view: TutorialView | null): void;
  highlight(hexes: readonly Hex[]): void;
  /** Show a pointer dragging across these tiles, over and over (none: stop showing it). */
  pointer(path: readonly Hex[]): void;
  /** Has everything that was moving on the board arrived (every tile shows what it now is)? */
  settled(): boolean;
  /** Called when the tutorial ends (finished or abandoned). */
  leave(): void;
}

/**
 * Runs the tutorial: one lesson at a time, each a small scripted match (see `lessons.ts`) with a
 * guide that gives the player a task, notices when it is done, and moves on.
 */
export class TutorialRunner {
  private lessonIndex = 0;
  private stepIndex = 0;
  private match: LocalMatch | null = null;
  private lesson: Lesson | null = null;
  /** The board each page of the lesson starts from, so every page can be entered afresh. */
  private starts: GameState[] = [];
  private startTick = 0;
  private startOrders = 0;
  /** While a step is being set up, messages do not count as the player doing anything. */
  private entering = true;
  private done = false;
  private finished = false;
  private failure: string | null = null;
  /** A pending look at the step again, once the board has caught up with the match. */
  private recheck: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly env: TutorialEnv) {}

  get active(): boolean {
    return this.lesson !== null;
  }

  /** Begin (or restart) a lesson from its first step. */
  start(lessonIndex = 0, stepIndex = 0): void {
    if (this.recheck) clearTimeout(this.recheck);
    this.recheck = null;
    this.match?.dispose();
    const lesson = LESSONS[lessonIndex];
    if (!lesson) return this.exit();
    this.lessonIndex = lessonIndex;
    this.lesson = lesson;
    this.entering = true;
    this.finished = false;
    this.env.reset();
    this.env.game.names = { ...lesson.names };

    let initial = parseMap(lesson.map, lesson.players);
    if (lesson.setup) initial = lesson.setup(initial);
    // A page with a setup starts from that setup applied to the lesson's opening board; a page
    // without one starts as the page before it did.
    let before = initial;
    this.starts = lesson.steps.map((step) => (before = step.setup ? step.setup(initial) : before));
    const config = tutorialConfig(lesson);
    this.match = new LocalMatch({
      state: structuredClone(this.starts[stepIndex] ?? initial),
      config,
      you: YOU,
      ...(lesson.bot ? { bot: lesson.bot } : {}),
      onMessage: (message) => {
        this.env.receive(message);
        this.evaluate();
      },
      onClock: (nextTickAt) => {
        this.env.game.nextTickAt = nextTickAt;
      },
    });
    // The first view goes up before the board is drawn, so the board is on screen to draw on.
    this.stepIndex = 0;
    this.publish();
    this.match.start();
    this.enter(stepIndex);
  }

  /** The last page is done: stop everything and let the screen congratulate the player. */
  private finish(): void {
    this.match?.setRunning(false);
    this.env.highlight([]);
    this.env.pointer([]);
    this.finished = true;
    this.publish();
  }

  /** Leave the tutorial. */
  exit(): void {
    if (this.recheck) clearTimeout(this.recheck);
    this.recheck = null;
    this.match?.dispose();
    this.match = null;
    this.lesson = null;
    this.env.highlight([]);
    this.env.pointer([]);
    this.env.reset();
    this.env.show(null);
    this.env.leave();
  }

  /** The player's side of the protocol while the tutorial is on. */
  handle(message: ClientMessage): void {
    this.match?.handle(message);
  }

  next(): void {
    const lesson = this.lesson;
    if (!lesson || this.failure !== null) return;
    if (this.stepIndex + 1 < lesson.steps.length)
      this.enter(this.stepIndex + 1, lesson.steps[this.stepIndex + 1]?.carry === true);
    else if (this.lessonIndex + 1 < LESSONS.length) this.start(this.lessonIndex + 1);
    else this.finish();
  }

  back(): void {
    const lesson = this.lesson;
    if (!lesson) return;
    if (this.stepIndex > 0) this.enter(this.stepIndex - 1);
    // Back from the first page of a lesson is the last page of the one before.
    else if (this.lessonIndex > 0) {
      const before = LESSONS[this.lessonIndex - 1]!;
      this.start(this.lessonIndex - 1, before.steps.length - 1);
    }
  }

  /** Start a lesson over from the beginning (also how the player jumps to a lesson). */
  jump(lessonIndex: number): void {
    this.start(lessonIndex);
  }

  /** Put the player back at the start of the current step. */
  retry(): void {
    const step = this.lesson?.steps[this.stepIndex];
    this.enter(step?.retryAt ?? this.stepIndex);
  }

  /** Check the current step against the game; called after every message and on a timer. */
  evaluate(): void {
    const { lesson, match } = this;
    if (!lesson || !match || this.failure !== null || this.entering) return;
    const step = lesson.steps[this.stepIndex];
    if (!step) return;
    const ctx = this.context();

    // A step that waits for the first order starts the clock once there is one.
    if (
      step.clock === 'after-order' &&
      !match.isRunning &&
      (ctx.queueLength > 0 || ctx.ordersRun > 0)
    ) {
      match.setRunning(true);
    }

    // The board takes a moment to catch up with the match (an army walks onto its tile before the
    // tile changes color). A task is not done, and a step has not failed, until the player can
    // see it: look again once everything has arrived.
    const failed = step.fail?.(ctx) ?? null;
    const finished = !!step.done && !this.done && step.done(ctx);
    if ((failed !== null || finished) && !this.env.settled()) {
      this.recheck ??= setTimeout(() => {
        this.recheck = null;
        this.evaluate();
      }, 60);
      return;
    }
    if (failed !== null) {
      this.failure = failed;
      match.setRunning(false);
      this.env.pointer([]);
      this.publish();
      return;
    }
    if (finished) {
      // The player goes on when they are ready: nothing moves them along.
      this.done = true;
      this.env.pointer([]);
      this.publish();
    }
  }

  // -- Internals ------------------------------------------------------------------------

  private context(): Ctx {
    const match = this.match!;
    const state = match.state;
    return {
      game: this.env.game,
      state,
      queueLength: match.queue.length,
      ordersRun: match.ordersRun - this.startOrders,
      ticksSinceStart: state.tick - this.startTick,
      tile: (hex) => {
        const tile = state.tiles[hexKey(hex)];
        if (!tile) throw new Error(`no tile at ${hexKey(hex)}`);
        return tile;
      },
      owns: (hex) => state.tiles[hexKey(hex)]?.owner === YOU,
    };
  }

  /** Begin a step: set the scene, the clock and the pointers. */
  private enter(index: number, carry = false): void {
    if (this.recheck) clearTimeout(this.recheck);
    this.recheck = null;
    const { lesson, match } = this;
    if (!lesson || !match) return;
    this.entering = true;
    this.stepIndex = index;
    this.failure = null;
    this.done = false;
    const step = lesson.steps[index]!;

    // Every page starts from its own board, whatever happened on the page before (or whichever
    // way the player got here).
    match.setRunning(false);
    if (!carry) match.restore(structuredClone(this.starts[index]!), []);
    this.startTick = match.state.tick;
    this.startOrders = match.ordersRun;

    this.env.highlight(step.tiles ?? []);
    this.env.pointer(step.drag ?? []);
    match.setRunning(step.clock === 'running');
    this.entering = false;
    this.publish();
    // A task that is already done when the step begins needs no waiting.
    this.evaluate();
  }

  private publish(): void {
    const { lesson } = this;
    if (!lesson) return;
    const step = lesson.steps[this.stepIndex]!;
    this.env.show({
      lessons: LESSONS.map((l) => l.title),
      lesson: this.lessonIndex,
      step: this.stepIndex,
      steps: lesson.steps.length,
      title: lesson.title,
      text: step.text,
      done: step.done === undefined || this.done,
      hasTask: step.done !== undefined,
      failure: this.failure,
      hud: step.hud ?? null,
      hudOutline: step.hudOutline ?? true,
      last: this.stepIndex === lesson.steps.length - 1 && this.lessonIndex === LESSONS.length - 1,
      finished: this.finished,
    });
  }
}
