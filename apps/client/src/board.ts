import { Application, Container, Graphics, Text } from 'pixi.js';
import {
  generationInterval,
  hexKey,
  isGenerationPaused,
  type Hex,
  type Order,
  type Tile,
} from '@hexxar/shared';
import type { GameView } from './game.js';
import { HEX_SIZE, hexCorners, hexToPixel, pixelToHex, type Point } from './layout.js';

/** Distinct, flat player colors, assigned by player order. */
export const PLAYER_COLORS = [
  0x4f9dff, 0xff6b6b, 0xffd166, 0x06d6a0, 0xc77dff, 0xff9f43, 0x2ec4b6, 0xf15bb5,
];

const BACKGROUND = 0x14161c;
const NEUTRAL_FILL = { farmland: 0x242932, village: 0x282e39, city: 0x2d3441 } as const;
const NEUTRAL_ICON = 0xaab3c8;
/** How much of the owner color is mixed into an owned tile's fill: richer for more valuable tiles. */
const OWNED_FILL = { farmland: 0.4, village: 0.55, city: 0.7 } as const;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;
const RING_RADIUS = 20.5;
/** Inset of the inner wall border from the hex edge: far enough out to clear the progress ring. */
const WALL_INSET = 4.5;
const MAX_RING_SEGMENTS = 36;

export function playerColor(game: GameView, owner: string | null): number | null {
  if (owner === null) return null;
  const index = game.players.indexOf(owner);
  return PLAYER_COLORS[(index < 0 ? 0 : index) % PLAYER_COLORS.length] ?? null;
}

/** Blend two 0xRRGGBB colors; `amount` is how much of `b` to mix in. */
function mix(a: number, b: number, amount: number): number {
  const channel = (shift: number): number => {
    const ca = (a >> shift) & 0xff;
    const cb = (b >> shift) & 0xff;
    return Math.round(ca + (cb - ca) * amount);
  };
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

interface TileView {
  readonly shape: Graphics;
  readonly label: Text;
}

/** What the board reports about the player's left-button drags. */
export interface OrderDragHandlers {
  /** Can a left-drag starting on this hex issue orders? If not, the drag is ignored. */
  canStart(hex: Hex): boolean;
  start(hex: Hex): void;
  move(hex: Hex): void;
  /** Button released: commit the path. */
  end(): void;
  /** Escape pressed or the pointer was lost: discard the path. */
  cancel(): void;
}

/**
 * Draws the hex map and handles input: left-drag from a hex you can command draws an
 * order path (left-drag from anywhere else does nothing), right or middle drag pans,
 * and the wheel zooms.
 */
export class Board {
  private readonly world = new Container();
  private readonly tileLayer = new Container();
  private readonly queueLayer = new Graphics();
  private readonly pendingLayer = new Graphics();
  private readonly selectionLayer = new Graphics();
  private readonly views = new Map<string, TileView>();
  private fitted = false;
  /** Pixel density the troop labels are currently rendered at. */
  private textResolution = window.devicePixelRatio || 1;

  private constructor(
    private readonly app: Application,
    private readonly handlers: OrderDragHandlers,
  ) {
    this.world.addChild(this.tileLayer, this.queueLayer, this.pendingLayer, this.selectionLayer);
    app.stage.addChild(this.world);
    this.attachInput();
  }

  static async create(host: HTMLElement, handlers: OrderDragHandlers): Promise<Board> {
    const app = new Application();
    await app.init({
      resizeTo: window,
      background: BACKGROUND,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });
    host.appendChild(app.canvas);
    return new Board(app, handlers);
  }

  /** Rebuild everything from the full game view. */
  setAll(game: GameView): void {
    this.tileLayer.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.views.clear();
    for (const tile of Object.values(game.tiles)) this.updateTile(tile, game);
    if (!this.fitted && this.views.size > 0) {
      this.fitToBoard();
      this.fitted = true;
    }
  }

  updateTiles(tiles: readonly Tile[], game: GameView): void {
    for (const tile of tiles) this.updateTile(tile, game);
  }

  private updateTile(tile: Tile, game: GameView): void {
    const key = hexKey(tile);
    let view = this.views.get(key);
    if (!view) {
      const center = hexToPixel(tile);
      const label = new Text({
        text: '',
        style: {
          fontSize: 16,
          fontWeight: '700',
          fill: 0xffffff,
          // A dark outline keeps the number readable on top of the tile art.
          stroke: { color: 0x0e1016, width: 3.5, join: 'round' },
          fontFamily: 'system-ui, sans-serif',
        },
        resolution: this.textResolution,
      });
      label.anchor.set(0.5);
      label.position.set(center.x, center.y + 1);
      view = { shape: new Graphics(), label };
      this.tileLayer.addChild(view.shape, view.label);
      this.views.set(key, view);
    }

    const center = hexToPixel(tile);
    const owner = playerColor(game, tile.owner);
    const fill = owner === null ? NEUTRAL_FILL[tile.type] : mix(BACKGROUND, owner, OWNED_FILL[tile.type]);
    const shape = view.shape;
    shape.clear();
    shape.poly(hexCorners(center, 1.5)).fill(fill);
    if (owner !== null) shape.poly(hexCorners(center, 1.5)).stroke({ width: 1.5, color: owner });

    // Tile type art sits behind the troop count. Villages and cities have a defensive bonus,
    // shown as an inner border (fainter for villages, riveted for cities).
    // On owned tiles the art is a pale tint of the owner color so it stands out from the fill.
    const iconColor = owner === null ? NEUTRAL_ICON : mix(owner, 0xffffff, 0.65);
    const art = tileArtColors(fill, iconColor);
    if (tile.type === 'farmland') {
      drawFarmland(shape, center, art);
    } else if (tile.type === 'village') {
      shape.poly(hexCorners(center, WALL_INSET)).stroke({ width: 1, color: art.border });
      drawVillage(shape, center, art, fill);
    } else {
      const inner = hexCorners(center, WALL_INSET);
      shape.poly(inner).stroke({ width: 1.5, color: art.border });
      for (let i = 0; i < inner.length; i += 2) {
        shape.circle(inner[i]!, inner[i + 1]!, 1.6).fill(art.border);
      }
      drawCastle(shape, center, art, fill);
    }
    this.drawProgressRing(shape, tile, center, owner, game);
    view.label.text = String(tile.troops);
  }

  /**
   * A ring of segments around an owned tile, one per tick of its generation cycle.
   * Filled segments are progress; when the tile is at its troop cap the progress is
   * kept but shown dimmed, since it is paused.
   */
  private drawProgressRing(
    shape: Graphics,
    tile: Tile,
    center: Point,
    owner: number | null,
    game: GameView,
  ): void {
    if (owner === null || !game.config) return;
    const total = generationInterval(game.config, tile.type);
    if (total < 2) return;
    const paused = isGenerationPaused(game.config, tile);
    // Very long cycles collapse into a fixed number of chunks.
    const segments = Math.min(total, MAX_RING_SEGMENTS);
    const filled = Math.floor((tile.progress * segments) / total);
    const step = (Math.PI * 2) / segments;
    const gap = Math.min(0.12, step * 0.3);
    for (let i = 0; i < segments; i++) {
      const start = -Math.PI / 2 + i * step + gap / 2;
      const end = start + step - gap;
      const on = i < filled;
      const color = on && paused ? 0xffffff : owner;
      const alpha = on ? (paused ? 0.4 : 1) : 0.22;
      shape
        .moveTo(center.x + RING_RADIUS * Math.cos(start), center.y + RING_RADIUS * Math.sin(start))
        .arc(center.x, center.y, RING_RADIUS, start, end)
        .stroke({ width: 2.5, color, alpha });
    }
  }

  /** Draw the player's queued moves as arrows. */
  drawQueue(queue: readonly Order[], color: number): void {
    const g = this.queueLayer;
    g.clear();
    queue.slice(0, 300).forEach((order, i) => {
      drawArrow(g, order.from, order.to, color, i === 0 ? 1 : 0.55);
    });
  }

  /** Draw the path being dragged out, before it is committed. */
  drawPending(path: readonly Hex[]): void {
    const g = this.pendingLayer;
    g.clear();
    for (let i = 1; i < path.length; i++) {
      drawArrow(g, path[i - 1]!, path[i]!, 0xffffff, 0.9);
    }
    const end = path.at(-1);
    if (end && path.length > 1) {
      g.poly(hexCorners(hexToPixel(end), 3)).stroke({ width: 2, color: 0xffffff, alpha: 0.6 });
    }
  }

  /**
   * Troop labels are textures, so they blur when the world is scaled up. Keep their
   * resolution matched to the zoom (in coarse steps, so this rarely re-renders them).
   */
  private syncTextResolution(): void {
    const dpr = window.devicePixelRatio || 1;
    const wanted = Math.min(dpr * 4, Math.max(dpr, Math.ceil(dpr * this.world.scale.x * 2) / 2));
    if (wanted === this.textResolution) return;
    this.textResolution = wanted;
    for (const { label } of this.views.values()) label.resolution = wanted;
  }

  setSelection(hex: Hex | null): void {
    const g = this.selectionLayer;
    g.clear();
    if (!hex) return;
    g.poly(hexCorners(hexToPixel(hex), 0)).stroke({ width: 3, color: 0xffffff });
  }

  /** Zoom and center so the whole board is visible. */
  fitToBoard(): void {
    const bounds = this.tileLayer.getLocalBounds();
    const { width, height } = this.app.screen;
    const scale = Math.min(
      MAX_ZOOM,
      Math.max(MIN_ZOOM, Math.min((width * 0.9) / bounds.width, (height * 0.9) / bounds.height)),
    );
    this.world.scale.set(scale);
    this.syncTextResolution();
    this.world.position.set(
      width / 2 - (bounds.x + bounds.width / 2) * scale,
      height / 2 - (bounds.y + bounds.height / 2) * scale,
    );
  }

  private hexAt(e: PointerEvent): Hex {
    const rect = this.app.canvas.getBoundingClientRect();
    const local = this.world.toLocal({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    return pixelToHex(local as Point);
  }

  private attachInput(): void {
    const canvas = this.app.canvas;
    let mode: { kind: 'order' } | { kind: 'pan'; x: number; y: number } | null = null;

    const cancelOrder = (): void => {
      if (mode?.kind !== 'order') return;
      mode = null;
      this.handlers.cancel();
    };

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      if (mode || e.button > 2) return;
      const hex = this.hexAt(e);
      if (e.button === 0) {
        // The left button only ever gives orders, so a stray left-drag can never pan.
        if (!this.handlers.canStart(hex)) return;
        canvas.setPointerCapture(e.pointerId);
        mode = { kind: 'order' };
        this.handlers.start(hex);
      } else {
        canvas.setPointerCapture(e.pointerId);
        mode = { kind: 'pan', x: e.clientX, y: e.clientY };
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (mode?.kind === 'order') {
        this.handlers.move(this.hexAt(e));
      } else if (mode?.kind === 'pan') {
        this.world.position.x += e.clientX - mode.x;
        this.world.position.y += e.clientY - mode.y;
        mode.x = e.clientX;
        mode.y = e.clientY;
      }
    });
    canvas.addEventListener('pointerup', () => {
      const finished = mode;
      mode = null;
      if (finished?.kind === 'order') this.handlers.end();
    });
    canvas.addEventListener('pointercancel', cancelOrder);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') cancelOrder();
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const cursor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        const before = this.world.toLocal(cursor);
        const next = Math.min(
          MAX_ZOOM,
          Math.max(MIN_ZOOM, this.world.scale.x * 1.1 ** -Math.sign(e.deltaY)),
        );
        this.world.scale.set(next);
        this.syncTextResolution();
        // Keep the point under the cursor fixed while zooming.
        this.world.position.set(cursor.x - before.x * next, cursor.y - before.y * next);
      },
      { passive: false },
    );
  }
}

/** An arrow from the middle of one hex to just short of the center of the next. */
function drawArrow(g: Graphics, from: Hex, to: Hex, color: number, alpha: number): void {
  const a = hexToPixel(from);
  const b = hexToPixel(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const start = { x: a.x + ux * HEX_SIZE * 0.2, y: a.y + uy * HEX_SIZE * 0.2 };
  const end = { x: b.x - ux * HEX_SIZE * 0.25, y: b.y - uy * HEX_SIZE * 0.25 };
  g.moveTo(start.x, start.y).lineTo(end.x, end.y).stroke({ width: 3, color, alpha });
  const head = 8;
  g.poly([
    end.x + ux * head,
    end.y + uy * head,
    end.x - ux * head * 0.4 - uy * head * 0.6,
    end.y - uy * head * 0.4 + ux * head * 0.6,
    end.x - ux * head * 0.4 + uy * head * 0.6,
    end.y - uy * head * 0.4 - ux * head * 0.6,
  ]).fill({ color, alpha });
}

/**
 * Tile art is drawn in opaque colors, pre-blended against the tile fill, rather than with
 * transparency: overlapping shapes then merge seamlessly instead of showing darker seams.
 */
interface ArtColors {
  /** Very faint: field furrows. */
  readonly faint: number;
  /** Walls and bodies. */
  readonly wall: number;
  /** Roofs, towers and other emphasized shapes. */
  readonly roof: number;
  /** Inner border lines. */
  readonly border: number;
  /** Flag and other highlights. */
  readonly accent: number;
}

function tileArtColors(fill: number, icon: number): ArtColors {
  return {
    faint: mix(fill, icon, 0.2),
    wall: mix(fill, icon, 0.4),
    roof: mix(fill, icon, 0.7),
    border: mix(fill, icon, 0.5),
    accent: mix(fill, icon, 0.95),
  };
}

/** Plowed field: a few curved furrows, kept inside the progress ring. */
function drawFarmland(g: Graphics, c: Point, art: ArtColors): void {
  const rows: [number, number][] = [
    [-12, 13],
    [-4, 16],
    [4, 16],
    [12, 13],
  ];
  for (const [y, halfWidth] of rows) {
    g.moveTo(c.x - halfWidth, c.y + y)
      .quadraticCurveTo(c.x, c.y + y - 3.5, c.x + halfWidth, c.y + y)
      .stroke({ width: 2, color: art.faint, cap: 'round' });
  }
}

/**
 * Two cottages with steep gabled roofs, one with a chimney. Coordinates are offsets from
 * the hex center and stay within the progress ring. `cutout` is the tile's fill color,
 * used to carve doorways.
 */
function drawVillage(g: Graphics, c: Point, art: ArtColors, cutout: number): void {
  const at = (x: number, y: number): [number, number] => [c.x + x, c.y + y];
  // Large cottage with a chimney.
  g.rect(...at(-5.5, -4), 2, 4).fill(art.roof);
  g.rect(...at(-14, 3), 12, 9).fill(art.wall);
  g.poly([...at(-16, 3), ...at(-8, -6), ...at(0, 3)]).fill(art.roof);
  g.rect(...at(-9, 7), 4, 5).fill(cutout);
  // Small cottage.
  g.rect(...at(3, 6), 10, 6).fill(art.wall);
  g.poly([...at(1, 6), ...at(8, -1), ...at(15, 6)]).fill(art.roof);
}

/**
 * A castle: a crenellated keep with a gate and flag between two towers with pointed
 * roofs. Offsets are from the hex center and stay within the progress ring.
 */
function drawCastle(g: Graphics, c: Point, art: ArtColors, cutout: number): void {
  const at = (x: number, y: number): [number, number] => [c.x + x, c.y + y];
  // Curtain wall joining keep and towers.
  g.rect(...at(-10, 2), 20, 10).fill(art.wall);
  // Side towers with pointed roofs.
  for (const x0 of [-15, 9]) {
    g.rect(...at(x0, -6), 6, 18).fill(art.wall);
    g.poly([...at(x0 - 1, -6), ...at(x0 + 3, -14), ...at(x0 + 7, -6)]).fill(art.roof);
  }
  // Keep with battlements.
  g.rect(...at(-7, -3), 14, 15).fill(art.wall);
  for (const x of [-7, -1.5, 4]) g.rect(...at(x, -6), 3, 3).fill(art.wall);
  // Gate arch.
  g.rect(...at(-2.5, 6), 5, 6).fill(cutout);
  g.circle(...at(0, 6), 2.5).fill(cutout);
  // Flag.
  g.moveTo(...at(0, -6))
    .lineTo(...at(0, -15))
    .stroke({ width: 1.2, color: art.roof });
  g.poly([...at(0, -15), ...at(6, -12.5), ...at(0, -10)]).fill(art.accent);
}
