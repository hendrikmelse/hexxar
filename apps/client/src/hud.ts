import type { GameView } from './game.js';
import { playerColor } from './board.js';
import { appStore } from './store.js';
import './hud.css';

const css = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

/** How long the controls reminder stays bright before it fades into the background. */
const HINT_BRIGHT_MS = 14_000;
/** A "Really surrender?" prompt goes back to a plain button after this long. */
const CONFIRM_MS = 4000;

/** What the HUD's buttons do. */
export interface HudActions {
  surrender(): void;
  /** Show the whole board. */
  fit(): void;
  /** Jump to the player's own land. */
  home(): void;
  zoom(factor: number): void;
}

interface Row {
  readonly item: HTMLLIElement;
  readonly swatch: HTMLElement;
  readonly label: HTMLElement;
  readonly tiles: HTMLElement;
  readonly troops: HTMLElement;
  readonly share: HTMLElement;
}

const SVG = 'http://www.w3.org/2000/svg';
/** A pointy-top hexagon in a 100x100 box, starting at the top and running clockwise. */
const HEX_RING = 'M50 6 L88.1 28 L88.1 72 L50 94 L11.9 72 L11.9 28 Z';

/**
 * DOM overlay for a match: a hexagonal tick timer with your order queue, the player list,
 * camera and surrender buttons, a banner for messages, and a reminder of the controls.
 * The match result is the results screen's job.
 */
export class Hud {
  private readonly badge = el('div', 'tick-badge');
  private readonly ring: SVGPathElement;
  private readonly badgeLabel = el('span', 'tick-label');
  private readonly badgeNumber = el('span', 'tick-number');
  private readonly queue = el('div', 'queue');
  private readonly queueCount = el('strong', '');
  private readonly queueText = el('span', '');
  private readonly standings = el('ol', 'standings');
  private readonly rows = new Map<string, Row>();
  private readonly banner = el('div', 'banner');
  private readonly surrender = el('button', 'surrender');
  private readonly hint = el('div', 'hint');
  private game: GameView | null = null;
  private lastTick = -1;
  /** How long the planning period was when we first saw it, for drawing the countdown ring. */
  private prepTotal = 0;
  private hintTimer: ReturnType<typeof setTimeout> | null = null;
  private confirmTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    root: HTMLElement,
    private readonly actions: HudActions,
  ) {
    // The timer: a hexagon whose edge fills up over each tick.
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    const plate = document.createElementNS(SVG, 'path');
    plate.setAttribute('d', 'M50 1 L92.3 25.5 L92.3 74.5 L50 99 L7.7 74.5 L7.7 25.5 Z');
    plate.setAttribute('class', 'plate');
    const track = document.createElementNS(SVG, 'path');
    track.setAttribute('d', HEX_RING);
    track.setAttribute('class', 'track');
    this.ring = document.createElementNS(SVG, 'path');
    this.ring.setAttribute('d', HEX_RING);
    this.ring.setAttribute('class', 'ring');
    this.ring.setAttribute('pathLength', '100');
    svg.append(plate, track, this.ring);
    const face = el('div', 'tick-face');
    face.append(this.badgeLabel, this.badgeNumber);
    this.badge.append(svg, face);

    // Next to the timer: how many orders you have waiting to run.
    const queueLabel = el('span', 'queue-label');
    queueLabel.textContent = 'Order queue';
    const queueRow = el('div', 'queue-row');
    queueRow.append(this.queueCount, this.queueText);
    this.queue.append(queueLabel, queueRow);
    const status = el('div', 'status');
    status.append(this.badge, this.queue);

    const players = el('div', 'players');
    const heading = el('h3', '');
    heading.textContent = 'Players';
    players.append(heading, this.standings);
    const left = el('div', 'left');
    left.append(status, players);

    const top = el('div', 'top');
    top.append(this.banner);

    this.surrender.textContent = 'Surrender';
    this.surrender.addEventListener('click', () => this.onSurrenderClick());

    const camera = el('div', 'camera');
    camera.append(
      cameraButton('+', 'Zoom in', () => actions.zoom(1.3)),
      cameraButton('−', 'Zoom out', () => actions.zoom(1 / 1.3)),
      cameraButton('', 'Show the whole board', () => actions.fit(), 'fit'),
      cameraButton('', 'Go to your land', () => actions.home(), 'home'),
    );

    this.hint.append(
      hintItem('Drag', 'from your land to queue moves'),
      hintItem('Right-drag', 'pan'),
      hintItem('Scroll', 'zoom'),
      hintItem('Esc', 'cancel a drag'),
    );

    root.append(left, top, this.surrender, camera, this.hint);
    const frame = (): void => {
      this.updateTimer();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  render(game: GameView): void {
    const wasPlaying = this.game?.status === 'playing';
    this.game = game;
    const live = game.status === 'playing' || game.status === 'over';
    const me = game.playerId;
    const eliminated = me !== null && game.eliminated.includes(me);

    if (game.tick !== this.lastTick) {
      this.lastTick = game.tick;
      restartAnimation(this.badge, 'ticked');
    }
    this.queueCount.textContent = String(game.queue.length);
    this.queueText.textContent = game.queue.length === 1 ? 'order' : 'orders';
    this.queue.classList.toggle('busy', game.queue.length > 0);
    this.queue.hidden = !live || eliminated;

    this.renderStandings(game, live);
    this.surrender.hidden = game.status !== 'playing' || eliminated;
    if (this.surrender.hidden) this.resetSurrender();

    // The match result is shown by the results screen, not here.
    let text = '';
    let kind = '';
    if (eliminated && game.status === 'playing') text = 'You were eliminated';
    else if (game.notice) text = game.notice;
    else if (this.preparing(game)) {
      text = 'Plan your opening: drag from your land to queue orders';
      kind = 'prep';
    }
    this.setBanner(text, kind);

    // Remind new players of the controls, then let the reminder fade away.
    if (game.status === 'playing' && !wasPlaying) this.brightenHint();
  }

  /** Before the first tick: the map is open for looking at and ordering, but nothing has moved. */
  private preparing(game: GameView): boolean {
    return game.status === 'playing' && game.tick === 0 && game.nextTickAt !== null;
  }

  private renderStandings(game: GameView, live: boolean): void {
    this.standings.hidden = !live;
    if (!live) {
      this.rows.clear();
      this.standings.replaceChildren();
      return;
    }
    const names = new Map(
      (appStore.get().room?.players ?? []).map((p) => [p.playerId ?? '', p.name] as const),
    );
    const totals = new Map<string, { tiles: number; troops: number }>();
    for (const id of game.players) totals.set(id, { tiles: 0, troops: 0 });
    let land = 0;
    for (const tile of Object.values(game.tiles)) {
      land += 1;
      const total = tile.owner === null ? undefined : totals.get(tile.owner);
      if (total) {
        total.tiles += 1;
        total.troops += tile.troops;
      }
    }
    const standings = game.players.map((id) => {
      const total = totals.get(id) ?? { tiles: 0, troops: 0 };
      return { id, ...total, out: game.eliminated.includes(id) };
    });
    // Whoever holds the most land leads; fallen players sink to the bottom.
    standings.sort(
      (a, b) => Number(a.out) - Number(b.out) || b.tiles - a.tiles || b.troops - a.troops,
    );

    standings.forEach((standing, index) => {
      let row = this.rows.get(standing.id);
      if (!row) {
        row = createRow();
        const color = playerColor(game, standing.id);
        if (color !== null) row.item.style.setProperty('--c', css(color));
        this.rows.set(standing.id, row);
      }
      const you = standing.id === game.playerId;
      row.label.textContent = names.get(standing.id) ?? standing.id;
      row.tiles.textContent = String(standing.tiles);
      row.troops.textContent = String(standing.troops);
      row.share.style.width = `${land > 0 ? (standing.tiles / land) * 100 : 0}%`;
      row.item.classList.toggle('me', you);
      row.item.classList.toggle('out', standing.out);
      row.item.dataset.rank = standing.out ? '' : String(index + 1);
      // Re-appending in order keeps the list sorted without rebuilding the rows.
      if (this.standings.children[index] !== row.item)
        this.standings.insertBefore(row.item, this.standings.children[index] ?? null);
    });
  }

  private setBanner(text: string, kind: string): void {
    const changed = this.banner.textContent !== text;
    this.banner.textContent = text;
    this.banner.className = `banner ${kind}`.trim();
    this.banner.hidden = text === '';
    if (changed && text !== '') restartAnimation(this.banner, 'pop');
  }

  /** Two steps, so a stray click can't end the match: the first asks, the second does it. */
  private onSurrenderClick(): void {
    if (this.confirmTimer === null) {
      this.surrender.textContent = 'Really surrender?';
      this.surrender.classList.add('confirm');
      this.confirmTimer = setTimeout(() => this.resetSurrender(), CONFIRM_MS);
      return;
    }
    this.resetSurrender();
    this.actions.surrender();
  }

  private resetSurrender(): void {
    if (this.confirmTimer) clearTimeout(this.confirmTimer);
    this.confirmTimer = null;
    this.surrender.textContent = 'Surrender';
    this.surrender.classList.remove('confirm');
  }

  private brightenHint(): void {
    this.hint.classList.remove('faded');
    if (this.hintTimer) clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => this.hint.classList.add('faded'), HINT_BRIGHT_MS);
  }

  /** The timer, every frame: a ring filling over each tick, or draining over the planning period. */
  private updateTimer(): void {
    const game = this.game;
    const live = game?.status === 'playing' && game.config && game.nextTickAt !== null;
    if (!game || !live) {
      this.setRing(0);
      this.badgeLabel.textContent = 'Tick';
      this.badgeNumber.textContent = String(game?.tick ?? 0);
      this.badge.classList.remove('prep');
      return;
    }
    const remaining = Math.max(0, game.nextTickAt! - (Date.now() + game.clockOffset));
    if (this.preparing(game)) {
      this.prepTotal = Math.max(this.prepTotal, remaining);
      this.setRing(this.prepTotal > 0 ? remaining / this.prepTotal : 0);
      this.badge.classList.add('prep');
      this.badgeLabel.textContent = 'Starts in';
      this.badgeNumber.textContent = String(Math.ceil(remaining / 1000));
      return;
    }
    this.prepTotal = 0;
    this.setRing(1 - Math.min(1, remaining / game.config!.tickMs));
    this.badge.classList.remove('prep');
    this.badgeLabel.textContent = 'Tick';
    this.badgeNumber.textContent = String(game.tick);
  }

  private setRing(progress: number): void {
    this.ring.style.strokeDashoffset = String(100 - progress * 100);
    this.ring.style.opacity = progress < 0.01 ? '0' : '1';
  }
}

function createRow(): Row {
  const item = el('li', 'standing');
  const swatch = el('span', 'swatch');
  const name = el('span', 'name');
  const label = el('span', '');
  name.append(label);
  const tiles = el('span', 'stat tiles');
  tiles.title = 'Tiles held';
  const troops = el('span', 'stat troops');
  troops.title = 'Troops';
  const share = el('span', 'share');
  share.append(el('i', ''));
  item.append(swatch, name, tiles, troops, share);
  return { item, swatch, label, tiles, troops, share: share.firstElementChild as HTMLElement };
}

function cameraButton(
  text: string,
  label: string,
  onClick: () => void,
  icon = '',
): HTMLButtonElement {
  const button = el('button', icon ? `icon ${icon}` : '');
  button.textContent = text;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.addEventListener('click', onClick);
  return button;
}

function hintItem(key: string, text: string): HTMLElement {
  const item = el('span', 'hint-item');
  const cap = el('kbd', '');
  cap.textContent = key;
  item.append(cap, document.createTextNode(text));
  return item;
}

/** Play a CSS animation again from the start, even if it is already running. */
function restartAnimation(node: HTMLElement, className: string): void {
  node.classList.remove(className);
  void node.offsetWidth;
  node.classList.add(className);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}
