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
  zoom(factor: number): void;
}

interface Row {
  readonly item: HTMLLIElement;
  readonly label: HTMLElement;
  readonly troops: HTMLElement;
}

const SVG = 'http://www.w3.org/2000/svg';
const RING_RADIUS = 43;
/** The pie's color when nobody produces anything. */
const NEUTRAL_SLICE = '#3d4350';

/**
 * DOM overlay for a match: a round tick timer with a pie of troop production, the player list,
 * camera and surrender buttons, a banner for messages, and a reminder of the controls.
 * The match result is the results screen's job.
 */
export class Hud {
  private readonly badge = el('div', 'tick-badge');
  private readonly ring: SVGCircleElement;
  private readonly badgeLabel = el('span', 'tick-label');
  private readonly badgeNumber = el('span', 'tick-number');
  private readonly pie = el('div', 'pie');
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
    // The timer: a ring that fills up over each tick. Before the first tick it counts down.
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    const circle = (className: string, radius: number): SVGCircleElement => {
      const node = document.createElementNS(SVG, 'circle');
      node.setAttribute('cx', '50');
      node.setAttribute('cy', '50');
      node.setAttribute('r', String(radius));
      node.setAttribute('class', className);
      return node;
    };
    this.ring = circle('ring', RING_RADIUS);
    // Start at the top and run clockwise.
    this.ring.setAttribute('transform', 'rotate(-90 50 50)');
    this.ring.setAttribute('pathLength', '100');
    svg.append(circle('plate', 49), circle('track', RING_RADIUS), this.ring);
    const face = el('div', 'tick-face');
    face.append(this.badgeLabel, this.badgeNumber);
    this.badge.append(svg, face);

    // The pie of who makes how many troops sits inside the timer.
    this.badge.insertBefore(this.pie, face);
    const status = el('div', 'status');
    status.append(this.badge);

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
    const mine = me === null ? null : playerColor(game, me);
    if (mine !== null) this.badge.style.setProperty('--c', css(mine));

    this.renderStandings(game, live);
    this.surrender.hidden = game.status !== 'playing' || eliminated;
    // Once the match is over the result screen takes over; the reminder would only be in its way.
    this.hint.hidden = game.status === 'over';
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
    // The server counts everyone's strength itself: under fog the board alone would not tell.
    const scores = new Map(game.scores.map((score) => [score.player, score] as const));
    const standings = game.players.map((id) => {
      const score = scores.get(id);
      return {
        id,
        tiles: score?.tiles ?? 0,
        troops: score?.troops ?? 0,
        capacity: score?.capacity ?? 0,
        out: game.eliminated.includes(id),
      };
    });
    // Whoever can produce the most troops leads; fallen players sink to the bottom.
    standings.sort(
      (a, b) =>
        Number(a.out) - Number(b.out) ||
        b.capacity - a.capacity ||
        b.tiles - a.tiles ||
        b.troops - a.troops,
    );

    this.renderPie(game, standings);

    standings.forEach((standing, index) => {
      let row = this.rows.get(standing.id);
      if (!row) {
        row = createRow();
        const color = playerColor(game, standing.id);
        if (color !== null) row.item.style.setProperty('--c', css(color));
        this.rows.set(standing.id, row);
      }
      const you = standing.id === game.playerId;
      row.label.textContent = game.names[standing.id] ?? names.get(standing.id) ?? standing.id;
      row.troops.textContent = String(standing.troops);
      row.item.classList.toggle('me', you);
      row.item.classList.toggle('out', standing.out);
      row.item.dataset.rank = standing.out ? '' : String(index + 1);
      // Re-appending in order keeps the list sorted without rebuilding the rows.
      if (this.standings.children[index] !== row.item)
        this.standings.insertBefore(row.item, this.standings.children[index] ?? null);
    });
  }

  /**
   * A pie of generation capacity (troops made per tick): a slice per player in their color, the
   * biggest first. A ring around it is lit white along your own slice. With nobody producing it
   * is plain grey.
   */
  private renderPie(game: GameView, standings: readonly { id: string; capacity: number }[]): void {
    const total = standings.reduce((sum, standing) => sum + standing.capacity, 0);
    const stops: string[] = [];
    let from = 0;
    let lit: [number, number] | null = null;
    for (const standing of [...standings].sort((a, b) => b.capacity - a.capacity)) {
      if (standing.capacity <= 0 || total <= 0) continue;
      const to = from + (standing.capacity / total) * 100;
      const color = playerColor(game, standing.id);
      stops.push(
        `${color === null ? '#8a93a8' : css(color)} ${from.toFixed(2)}% ${to.toFixed(2)}%`,
      );
      if (standing.id === game.playerId) lit = [from, to];
      from = to;
    }
    this.pie.style.background =
      stops.length > 0 ? `conic-gradient(${stops.join(', ')})` : NEUTRAL_SLICE;
    this.pie.style.setProperty(
      '--mine',
      lit
        ? `conic-gradient(transparent ${lit[0].toFixed(2)}%, #ffffff ${lit[0].toFixed(2)}% ${lit[1].toFixed(2)}%, transparent ${lit[1].toFixed(2)}%)`
        : 'none',
    );
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
      this.showCountdown(null);
      return;
    }
    const remaining = Math.max(0, game.nextTickAt! - (Date.now() + game.clockOffset));
    if (this.preparing(game)) {
      this.prepTotal = Math.max(this.prepTotal, remaining);
      this.setRing(this.prepTotal > 0 ? remaining / this.prepTotal : 0);
      this.showCountdown(Math.ceil(remaining / 1000));
      return;
    }
    this.prepTotal = 0;
    this.setRing(1 - Math.min(1, remaining / game.config!.tickMs));
    this.showCountdown(null);
  }

  /** Words in the middle of the timer: the seconds until the match starts, or nothing once it has. */
  private showCountdown(seconds: number | null): void {
    this.badge.classList.toggle('prep', seconds !== null);
    // The countdown takes the middle of the dial; the pie comes back once play starts.
    this.pie.hidden = seconds !== null;
    this.badgeLabel.textContent = seconds === null ? '' : 'Starts in';
    this.badgeNumber.textContent = seconds === null ? '' : String(seconds);
  }

  private setRing(progress: number): void {
    this.ring.style.strokeDashoffset = String(100 - progress * 100);
    this.ring.style.opacity = progress < 0.01 ? '0' : '1';
  }
}

function createRow(): Row {
  const item = el('li', 'standing');
  const name = el('span', 'name');
  const label = el('span', '');
  name.append(label);
  const troops = el('span', 'stat troops');
  troops.title = 'Troops';
  item.append(el('span', 'swatch'), name, troops);
  return { item, label, troops };
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
