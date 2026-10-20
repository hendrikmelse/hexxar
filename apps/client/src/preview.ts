import type { Order } from '@hexxar/shared';
import type { Graphics } from 'pixi.js';
import type { GameView } from './game.js';

/** How wide the previewer's panel is, which the board keeps clear when fitting itself. */
export const PREVIEW_PANEL_WIDTH = 380;

/**
 * The map previewer (`/?maps`) shows boards with the game's own board drawing. The previewer is
 * a page of the UI, and the board belongs to `main.ts`, so this is the little bridge between them.
 */
export interface PreviewSink {
  /** Show a board (as a match's view of it), fitted to the screen. */
  show(game: GameView): void;
  /** Draw players' queued orders as arrows, each in their own color. */
  queues(entries: readonly { queue: readonly Order[]; color: number }[]): void;
  /** Draw over the board, or clear it. */
  overlay(draw: ((graphics: Graphics) => void) | null): void;
}

let sink: PreviewSink | null = null;

/** The thumbnail page (`/?thumbnail`): a board with the title over it, to take a screenshot of. */
export const isThumbnail = (): boolean =>
  import.meta.env.DEV && new URLSearchParams(location.search).has('thumbnail');

/** Whether this page shows boards on its own (the map previewer or the thumbnail). Development only: in a production build these are just the game. */
export const isPreview = (): boolean =>
  (import.meta.env.DEV && new URLSearchParams(location.search).has('maps')) || isThumbnail();

/** `main.ts` says where previews go. */
export function setPreviewSink(next: PreviewSink): void {
  sink = next;
}

export const preview = {
  show: (game: GameView): void => sink?.show(game),
  queues: (entries: readonly { queue: readonly Order[]; color: number }[]): void =>
    sink?.queues(entries),
  overlay: (draw: ((graphics: Graphics) => void) | null): void => sink?.overlay(draw),
};
