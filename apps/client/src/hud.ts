import type { GameView } from './game.js';
import { playerColor } from './board.js';
import { appStore } from './store.js';
import './hud.css';

const css = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

/** How long the controls reminder stays bright before it fades into the background. */
const HINT_BRIGHT_MS = 12_000;

interface Standing {
  readonly id: string;
  readonly name: string;
  readonly color: number | null;
  readonly tiles: number;
  readonly troops: number;
  readonly out: boolean;
}

/**
 * DOM overlay for a match: scoreboard with the tick timer, your queue, surrender, a banner
 * for messages, and a reminder of the controls. The match result is the results screen's job.
 */
export class Hud {
  private readonly tickText = el('span', 'tick-count');
  private readonly queueText = el('span', 'queue-count');
  private readonly bar = el('div', 'tick-bar');
  private readonly barFill = el('div', 'tick-bar-fill');
  private readonly standings = el('ol', 'standings');
  private readonly banner = el('div', 'banner');
  private readonly surrender = el('button', 'surrender');
  private readonly hint = el('div', 'hint');
  private game: GameView | null = null;
  private hintTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(root: HTMLElement, onSurrender: () => void) {
    this.bar.append(this.barFill);

    const head = el('div', 'panel-head');
    const tick = el('span', 'tick');
    tick.append(textNode('Tick '), this.tickText);
    const queue = el('span', 'queue');
    queue.append(textNode('Queue '), this.queueText);
    head.append(tick, queue);

    const panel = el('div', 'panel');
    panel.append(head, this.bar, this.standings);

    this.surrender.textContent = 'Surrender';
    this.surrender.addEventListener('click', () => {
      if (confirm('Surrender this match?')) onSurrender();
    });

    this.hint.append(
      hintItem(['Drag'], 'from your land to queue moves'),
      hintItem(['Right-drag'], 'pan'),
      hintItem(['Scroll'], 'zoom'),
      hintItem(['Esc'], 'cancel a drag'),
    );

    root.append(panel, this.surrender, this.banner, this.hint);
    const frame = (): void => {
      this.updateBar();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  render(game: GameView): void {
    const wasPlaying = this.game?.status === 'playing';
    this.game = game;
    const live = game.status === 'playing' || game.status === 'over';
    const me = game.playerId;

    this.tickText.textContent = String(game.tick);
    this.queueText.textContent = String(game.queue.length);
    this.queueText.parentElement?.classList.toggle('busy', game.queue.length > 0);
    this.renderStandings(game, live);

    const eliminated = me !== null && game.eliminated.includes(me);
    this.surrender.hidden = game.status !== 'playing' || eliminated;

    // The match result is shown by the results screen, not here.
    let text = '';
    if (eliminated && game.status === 'playing') text = 'You were eliminated';
    else if (game.notice) text = game.notice;
    this.setBanner(text);

    // Remind new players of the controls, then let the reminder fade away.
    if (game.status === 'playing' && !wasPlaying) this.brightenHint();
  }

  private renderStandings(game: GameView, live: boolean): void {
    if (!live) {
      this.standings.replaceChildren();
      return;
    }
    const names = new Map(
      (appStore.get().room?.players ?? []).map((p) => [p.playerId ?? '', p.name] as const),
    );
    const totals = new Map<string, { tiles: number; troops: number }>();
    for (const id of game.players) totals.set(id, { tiles: 0, troops: 0 });
    for (const tile of Object.values(game.tiles)) {
      const total = tile.owner === null ? undefined : totals.get(tile.owner);
      if (total) {
        total.tiles += 1;
        total.troops += tile.troops;
      }
    }
    const rows: Standing[] = game.players.map((id) => ({
      id,
      name: names.get(id) ?? id,
      color: playerColor(game, id),
      tiles: totals.get(id)?.tiles ?? 0,
      troops: totals.get(id)?.troops ?? 0,
      out: game.eliminated.includes(id),
    }));
    // Whoever holds the most land leads; fallen players sink to the bottom.
    rows.sort((a, b) => Number(a.out) - Number(b.out) || b.tiles - a.tiles || b.troops - a.troops);

    this.standings.replaceChildren(
      ...rows.map((row, index) => {
        const item = el('li', 'standing');
        item.classList.toggle('me', row.id === game.playerId);
        item.classList.toggle('out', row.out);
        const rank = el('span', 'rank');
        rank.textContent = row.out ? '' : String(index + 1);
        const swatch = el('span', 'swatch');
        if (row.color !== null) swatch.style.background = css(row.color);
        const name = el('span', 'name');
        name.textContent = row.name;
        const tiles = el('span', 'stat tiles');
        tiles.title = 'Tiles held';
        tiles.textContent = String(row.tiles);
        const troops = el('span', 'stat troops');
        troops.title = 'Troops';
        troops.textContent = String(row.troops);
        item.append(rank, swatch, name, tiles, troops);
        return item;
      }),
    );
  }

  private setBanner(text: string): void {
    const changed = this.banner.textContent !== text;
    this.banner.textContent = text;
    this.banner.hidden = text === '';
    if (changed && text !== '') {
      // Restart the pop-in so a new message is noticed even if one was already showing.
      this.banner.style.animation = 'none';
      void this.banner.offsetWidth;
      this.banner.style.animation = '';
    }
  }

  private brightenHint(): void {
    this.hint.classList.remove('faded');
    if (this.hintTimer) clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => this.hint.classList.add('faded'), HINT_BRIGHT_MS);
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

function hintItem(keys: string[], text: string): HTMLElement {
  const item = el('span', 'hint-item');
  for (const key of keys) {
    const cap = el('kbd', '');
    cap.textContent = key;
    item.append(cap);
  }
  item.append(textNode(text));
  return item;
}

function textNode(text: string): Text {
  return document.createTextNode(text);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}
