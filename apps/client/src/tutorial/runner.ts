import {
  hexKey,
  type ClientMessage,
  type GameState,
  type Hex,
  type Order,
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
  readonly last: boolean;
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
  /** Called when the tutorial ends (finished or abandoned). */
  leave(): void;
}

/** How long a finished task is left on screen before the guide moves on by itself. */
const ADVANCE_MS = 1300;
/** How long a failure message is shown before the step starts over. */
const RETRY_MS = 3200;

interface Checkpoint {
  readonly state: GameState;
  readonly queue: readonly Order[];
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
  /** The state each step began from, for going back and for trying again. */
  private checkpoints: Checkpoint[] = [];
  private startTick = 0;
  /** While a step is being set up, messages do not count as the player doing anything. */
  private entering = true;
  private done = false;
  private failure: string | null = null;
  private advanceTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly env: TutorialEnv) {}

  get active(): boolean {
    return this.lesson !== null;
  }

  /** Begin (or restart) a lesson from its first step. */
  start(lessonIndex = 0): void {
    this.stopTimers();
    this.match?.dispose();
    const lesson = LESSONS[lessonIndex];
    if (!lesson) return this.exit();
    this.lessonIndex = lessonIndex;
    this.lesson = lesson;
    this.entering = true;
    this.checkpoints = [];
    this.env.reset();
    this.env.game.names = { ...lesson.names };

    let state = parseMap(lesson.map, lesson.players);
    if (lesson.setup) state = lesson.setup(state);
    const config = tutorialConfig(lesson);
    this.match = new LocalMatch({
      state,
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
    this.enter(0);
  }

  /** Leave the tutorial. */
  exit(): void {
    this.stopTimers();
    this.match?.dispose();
    this.match = null;
    this.lesson = null;
    this.env.highlight([]);
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
    if (this.stepIndex + 1 < lesson.steps.length) this.enter(this.stepIndex + 1);
    else if (this.lessonIndex + 1 < LESSONS.length) this.start(this.lessonIndex + 1);
    else this.exit();
  }

  back(): void {
    const lesson = this.lesson;
    if (!lesson) return;
    if (this.stepIndex > 0) this.enter(this.stepIndex - 1, true);
    else if (this.lessonIndex > 0) this.start(this.lessonIndex - 1);
  }

  /** Start a lesson over from the beginning (also how the player jumps to a lesson). */
  jump(lessonIndex: number): void {
    this.start(lessonIndex);
  }

  /** Put the player back at the start of the current step. */
  retry(): void {
    const step = this.lesson?.steps[this.stepIndex];
    this.enter(step?.retryAt ?? this.stepIndex, true);
  }

  /** Check the current step against the game; called after every message and on a timer. */
  evaluate(): void {
    const { lesson, match } = this;
    if (!lesson || !match || this.failure !== null || this.entering) return;
    const step = lesson.steps[this.stepIndex];
    if (!step) return;
    const ctx = this.context();

    const failed = step.fail?.(ctx) ?? null;
    if (failed !== null) {
      this.failure = failed;
      match.setRunning(false);
      this.publish();
      this.retryTimer = setTimeout(() => this.retry(), RETRY_MS);
      return;
    }
    if (step.done && !this.done && step.done(ctx)) {
      this.done = true;
      this.publish();
      this.advanceTimer = setTimeout(() => this.next(), ADVANCE_MS);
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
  private enter(index: number, restore = false): void {
    const { lesson, match } = this;
    if (!lesson || !match) return;
    this.stopTimers();
    this.entering = true;
    this.stepIndex = index;
    this.failure = null;
    this.done = false;
    const step = lesson.steps[index]!;

    match.setRunning(false);
    const saved = this.checkpoints[index];
    if (restore && saved) {
      // Back to how this step began (going back, or trying again).
      match.restore(structuredClone(saved.state), saved.queue);
    } else if (step.setup) {
      match.edit(step.setup);
    }
    // What this step began from, for next time. (A step's own setup is part of its start.)
    this.checkpoints[index] = { state: structuredClone(match.state), queue: [...match.queue] };
    this.checkpoints.length = index + 1;
    this.startTick = match.state.tick;

    this.env.highlight(step.tiles ?? []);
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
      last: this.stepIndex === lesson.steps.length - 1 && this.lessonIndex === LESSONS.length - 1,
    });
  }

  private stopTimers(): void {
    if (this.advanceTimer) clearTimeout(this.advanceTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.advanceTimer = null;
    this.retryTimer = null;
  }
}
