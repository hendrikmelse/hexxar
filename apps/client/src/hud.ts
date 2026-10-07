import type { GameView } from './game.js';
import { playerColor } from './board.js';

const css = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

/** DOM overlay: status, tick countdown, queue length, surrender, and result banners. */
export class Hud {
  private readonly status = el('div', 'status');
  private readonly bar = el('div', 'bar');
  private readonly barFill = el('div', 'bar-fill');
  private readonly banner = el('div', 'banner');
  private readonly surrender = el('button', 'surrender');
  private game: GameView | null = null;

  constructor(root: HTMLElement, onSurrender: () => void) {
    this.bar.append(this.barFill);
    const panel = el('div', 'panel');
    panel.append(this.status, this.bar);
    this.surrender.textContent = 'Surrender';
    this.surrender.addEventListener('click', () => {
      if (confirm('Surrender this match?')) onSurrender();
    });
    const hint = el('div', 'hint');
    hint.textContent =
      'Drag from your tiles to queue moves  ·  Right-drag to pan  ·  Scroll to zoom  ·  Esc cancels a drag';
    root.append(panel, this.surrender, this.banner, hint);
    const frame = (): void => {
      this.updateBar();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  render(game: GameView): void {
    this.game = game;
    const me = game.playerId;
    const color = me ? playerColor(game, me) : null;
    const swatch =
      color === null ? '' : `<span class="swatch" style="background:${css(color)}"></span>`;
    this.status.innerHTML =
      game.status === 'playing' || game.status === 'over'
        ? `${swatch}${me ?? ''} &middot; tick ${game.tick} &middot; queue ${game.queue.length}`
        : '';

    const eliminated = me !== null && game.eliminated.includes(me);
    this.surrender.hidden = game.status !== 'playing' || eliminated;

    let text = '';
    if (game.status === 'connecting') text = 'Connecting…';
    else if (game.status === 'waiting' || game.status === 'rejected') text = game.notice;
    else if (game.status === 'over') {
      text = game.winner === me ? 'Victory!' : `${game.winner ?? 'Nobody'} wins`;
    } else if (eliminated) text = 'You were eliminated';
    else if (game.notice) text = game.notice;
    this.banner.textContent = text;
    this.banner.hidden = text === '';
  }

  private updateBar(): void {
    const game = this.game;
    if (!game?.config || game.nextTickAt === null || game.status !== 'playing') {
      this.barFill.style.width = '0%';
      return;
    }
    const remaining = game.nextTickAt - (Date.now() + game.clockOffset);
    const progress = 1 - Math.min(1, Math.max(0, remaining / game.config.tickMs));
    this.barFill.style.width = `${progress * 100}%`;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}
