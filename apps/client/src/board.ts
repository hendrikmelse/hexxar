import { Application, Container, Graphics, Text } from 'pixi.js';
import {
  generationInterval,
  hexKey,
  ownedFarmNeighbors,
  isGenerationPaused,
  type Hex,
  type Order,
  type Tile,
} from '@hexxar/shared';
import type { GameView } from './game.js';
import { HEX_SIZE, hexCorners, hexToPixel, pixelToHex, type Point } from './layout.js';

/** Distinct, flat player colors, assigned by player order. */
const PLAYER_COLORS = [
  0x4f9dff, 0xff6b6b, 0xffd166, 0x06d6a0, 0xc77dff, 0xff9f43, 0x2ec4b6, 0xf15bb5,
];

/** The sea: land floats on it, and lakes are the holes in the board. */
const WATER = 0x0e1c27;
/** What owned tiles are tinted from, so owner colors look the same wherever they are. */
const OWNED_BASE = 0x14161c;
/** Unclaimed land: green fields, packed earth around a village, grey flagstones for a city. */
const NEUTRAL_FILL = { farmland: 0x2a3a2c, village: 0x3a382f, city: 0x3a3e46 } as const;
const NEUTRAL_ICON = 0xaab3c8;
/** The foam line where land meets water. */
const SHORE = 0x5f8ea3;
/** How much of the owner color is mixed into an owned tile's fill. */
const OWNED_FILL = 0.4;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 3;
/** Gap between neighboring tiles is twice this. */
const TILE_INSET = 0.5;
/**
 * Axial offsets of the neighbor across each hex edge. Edge i runs from corner i to corner
 * i + 1 (see `hexCorners`) and faces the angle 60 * i degrees, with y pointing down.
 */
const EDGE_NEIGHBORS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
  [1, -1],
];
const RING_RADIUS = 20.5;
/** Inset of the inner wall border from the hex edge: far enough out to clear the progress ring. */
const WALL_INSET = 4.5;
const MAX_RING_SEGMENTS = 36;
/** Screens at least this wide leave room for the HUD's left column when fitting the board. */
const WIDE_SCREEN = 900;
const LEFT_HUD_WIDTH = 296;

export function playerColor(game: GameView, owner: string | null): number | null {
  if (owner === null) return null;
  const index = Math.max(0, game.players.indexOf(owner));
  const palette = PLAYER_COLORS[index];
  if (palette !== undefined) return palette;
  // Beyond the hand-picked palette (big battle royales), space hues around the color wheel.
  return hslToHex((index * 137.508) % 360, 0.62, 0.6);
}

function hslToHex(hue: number, saturation: number, lightness: number): number {
  const a = saturation * Math.min(lightness, 1 - lightness);
  const channel = (n: number): number => {
    const k = (n + hue / 30) % 12;
    return Math.round(255 * (lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return (channel(0) << 16) | (channel(8) << 8) | channel(4);
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
  private readonly introLayer = new Container();
  private stopIntroFrame: (() => void) | null = null;
  private readonly views = new Map<string, TileView>();
  /** Pixel density the troop labels are currently rendered at. */
  private textResolution = window.devicePixelRatio || 1;

  private constructor(
    private readonly app: Application,
    private readonly handlers: OrderDragHandlers,
  ) {
    this.world.addChild(
      this.tileLayer,
      this.queueLayer,
      this.pendingLayer,
      this.selectionLayer,
      this.introLayer,
    );
    app.stage.addChild(this.world);
    this.attachInput();
  }

  static async create(host: HTMLElement, handlers: OrderDragHandlers): Promise<Board> {
    const app = new Application();
    await app.init({
      resizeTo: window,
      background: WATER,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });
    host.appendChild(app.canvas);
    return new Board(app, handlers);
  }

  /**
   * Rebuild everything from the full game view. A board appearing where there was none (a new
   * match) is fitted to the screen; a refresh of the same match keeps the player's view.
   */
  setAll(game: GameView): void {
    const fresh = this.views.size === 0;
    this.tileLayer.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.views.clear();
    for (const tile of Object.values(game.tiles)) this.updateTile(tile, game);
    if (fresh && this.views.size > 0) this.fitToBoard();
  }

  updateTiles(tiles: readonly Tile[], game: GameView): void {
    // A tile's outline depends on its neighbors' owners, so redraw those as well.
    const keys = new Set<string>();
    for (const tile of tiles) {
      keys.add(hexKey(tile));
      for (const [dq, dr] of EDGE_NEIGHBORS) keys.add(hexKey({ q: tile.q + dq, r: tile.r + dr }));
    }
    for (const key of keys) {
      const tile = game.tiles[key];
      if (tile) this.updateTile(tile, game);
    }
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
    const fill = owner === null ? NEUTRAL_FILL[tile.type] : mix(OWNED_BASE, owner, OWNED_FILL);
    const shape = view.shape;
    shape.clear();
    // Neutral tiles are drawn a pixel smaller, so they sit further apart than a connected group.
    const corners = hexCorners(center, owner === null ? TILE_INSET + 1 : TILE_INSET);
    shape.poly(corners).fill(fill);
    // Outline only the edges on the border of a group of same-owner tiles. The line follows the
    // true hex boundary rather than the inset fill, so neighboring tiles' edges meet exactly
    // at the shared corners and the group border has no breaks.
    if (owner !== null) {
      const boundary = hexCorners(center, 0);
      EDGE_NEIGHBORS.forEach(([dq, dr], i) => {
        if (game.tiles[hexKey({ q: tile.q + dq, r: tile.r + dr })]?.owner === tile.owner) return;
        const j = (i + 1) % 6;
        shape
          .moveTo(boundary[2 * i]!, boundary[2 * i + 1]!)
          .lineTo(boundary[2 * j]!, boundary[2 * j + 1]!)
          .stroke({ width: 1, color: owner, cap: 'round' });
      });
    }

    // Where the board meets water (its coast, or a lake), a pale foam line separates land from sea.
    const boundary = hexCorners(center, 0);
    EDGE_NEIGHBORS.forEach(([dq, dr], i) => {
      if (game.tiles[hexKey({ q: tile.q + dq, r: tile.r + dr })]) return;
      const j = (i + 1) % 6;
      shape
        .moveTo(boundary[2 * i]!, boundary[2 * i + 1]!)
        .lineTo(boundary[2 * j]!, boundary[2 * j + 1]!)
        .stroke({ width: 2.5, color: SHORE, alpha: 0.75, cap: 'round' });
    });

    // Tile type art sits behind the troop count. Villages and cities have a defensive bonus,
    // shown as an inner border (fainter for villages, riveted for cities).
    // On owned tiles the art is a pale tint of the owner color so it stands out from the fill.
    const iconColor = owner === null ? NEUTRAL_ICON : mix(owner, 0xffffff, 0.65);
    const art = tileArtColors(fill, iconColor, owner, tile.type);
    if (tile.type === 'farmland') {
      drawFarmland(shape, center, art);
    } else if (tile.type === 'village') {
      shape.poly(hexCorners(center, WALL_INSET)).stroke({ width: 1, color: art.villageBorder });
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
    // Only the owner sees a tile's generation timing.
    if (owner === null || tile.owner !== game.playerId || !game.config) return;
    // Only cities and villages produce troops, and the cycle shortens with each owned farm around them.
    const total = generationInterval(game.config, tile.type, ownedFarmNeighbors(game.tiles, tile));
    if (total === null || total < 2) return;
    const paused = isGenerationPaused(game.config, tile);
    // Very long cycles collapse into a fixed number of chunks.
    const segments = Math.min(total, MAX_RING_SEGMENTS);
    const filled = Math.floor((Math.min(tile.progress, total) * segments) / total);
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

  /**
   * A quick "you are here" for the start of a match: ripples spreading out from the player's
   * first tile, a pulsing outline and a marker that drops in. It ends by itself, or on
   * `stopIntro`, and never lingers into play.
   */
  playIntro(hex: Hex, color: number): void {
    this.stopIntro();
    const center = hexToPixel(hex);
    const rings = new Graphics();
    const marker = new Container();
    const pin = new Graphics();
    const label = new Text({
      text: 'YOU',
      style: {
        fontSize: 15,
        fontWeight: '800',
        fill: 0xffffff,
        stroke: { color: 0x0e1016, width: 4, join: 'round' },
        letterSpacing: 1.5,
        fontFamily: 'system-ui, sans-serif',
      },
      resolution: this.textResolution * 2,
    });
    label.anchor.set(0.5, 1);
    label.position.set(0, -18);
    pin.poly([-9, -14, 9, -14, 0, 0]).fill(0xffffff).stroke({ width: 2, color, join: 'round' });
    marker.addChild(pin, label);
    this.introLayer.addChild(rings, marker);

    const started = performance.now();
    const duration = 2600;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const frame = (): void => {
      const t = (performance.now() - started) / duration;
      if (t >= 1) return this.stopIntro();
      // Keep the effect readable on big boards, where the world is scaled right down.
      const k = Math.max(1, 0.5 / this.world.scale.x);
      rings.clear();
      if (!reduced) {
        for (let i = 0; i < 3; i++) {
          const p = t * 1.7 - i * 0.28;
          if (p <= 0 || p >= 1) continue;
          const radius = HEX_SIZE * k * (0.7 + p * 4.2);
          rings
            .circle(center.x, center.y, radius)
            .stroke({ width: 3 * k, color, alpha: (1 - p) ** 1.3 * 0.9 });
        }
      }
      // Outline of the tile itself, pulsing a few times.
      const pulse = 0.55 + 0.45 * Math.sin(t * Math.PI * 7);
      const fade = Math.min(1, (1 - t) * 4);
      rings
        .poly(hexCorners(center, 0))
        .stroke({ width: 3.5 * k, color: 0xffffff, alpha: pulse * fade });
      // The marker drops in from above, bounces once, and bobs until it fades.
      const drop = Math.min(1, t / 0.18);
      const bounce = drop < 1 ? (1 - drop) ** 2 * 60 * k : Math.sin(t * Math.PI * 9) * 3 * k;
      marker.scale.set(k);
      marker.position.set(center.x, center.y - HEX_SIZE * 0.55 * k - bounce);
      marker.alpha = reduced ? fade : Math.min(1, drop * 2) * fade;
    };
    this.app.ticker.add(frame);
    this.stopIntroFrame = () => this.app.ticker.remove(frame);
    frame();
  }

  stopIntro(): void {
    this.stopIntroFrame?.();
    this.stopIntroFrame = null;
    this.introLayer.removeChildren().forEach((child) => child.destroy({ children: true }));
  }

  /** Zoom in or out by `factor`, about the middle of the screen. */
  zoomBy(factor: number): void {
    const { width, height } = this.app.screen;
    const middle = { x: width / 2, y: height / 2 };
    const before = this.world.toLocal(middle);
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.world.scale.x * factor));
    this.world.scale.set(next);
    this.syncTextResolution();
    this.world.position.set(middle.x - before.x * next, middle.y - before.y * next);
  }

  /** Pan so a hex is in the middle of the screen, zooming in if the board is shown very small. */
  focusOn(hex: Hex): void {
    const { width, height } = this.app.screen;
    const center = hexToPixel(hex);
    const scale = Math.max(this.world.scale.x, 0.6);
    this.world.scale.set(scale);
    this.syncTextResolution();
    this.world.position.set(width / 2 - center.x * scale, height / 2 - center.y * scale);
  }

  /** Zoom and center so the whole board is visible. */
  fitToBoard(): void {
    const bounds = this.tileLayer.getLocalBounds();
    const { width, height } = this.app.screen;
    // On wide screens the HUD's left column takes up room, so the board is centered in the rest.
    const left = width >= WIDE_SCREEN ? LEFT_HUD_WIDTH : 0;
    const free = width - left;
    const scale = Math.min(
      MAX_ZOOM,
      Math.max(MIN_ZOOM, Math.min((free * 0.92) / bounds.width, (height * 0.9) / bounds.height)),
    );
    this.world.scale.set(scale);
    this.syncTextResolution();
    this.world.position.set(
      left + free / 2 - (bounds.x + bounds.width / 2) * scale,
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
  /** Crops. */
  readonly crop: number;
  /** Inner border lines on cities. */
  readonly border: number;
  /** Inner border line on villages: fainter than the city one. */
  readonly villageBorder: number;
  /** Flag, lit windows and other highlights. */
  readonly accent: number;
}

/**
 * Unclaimed tiles use natural colors (golden wheat, terracotta roofs, grey stone, blue slate
 * and a gold banner). Claimed tiles are all tinted from the owner color, so who holds a tile
 * reads at a glance.
 */
function tileArtColors(
  fill: number,
  icon: number,
  owner: number | null,
  type: Tile['type'],
): ArtColors {
  if (owner === null) {
    return {
      faint: mix(fill, 0xc9b458, 0.2),
      crop: 0xb9a548,
      wall: type === 'city' ? 0x8e96a5 : 0x9c8d74,
      roof: type === 'city' ? 0x5876a8 : 0xb55d42,
      border: mix(fill, 0xaab3c8, 0.55),
      villageBorder: mix(fill, 0xc9b79a, 0.35),
      accent: type === 'city' ? 0xe0b84c : 0xf0cf7a,
    };
  }
  return {
    faint: mix(fill, icon, 0.2),
    crop: mix(fill, icon, 0.55),
    wall: mix(fill, icon, 0.4),
    roof: mix(fill, icon, 0.7),
    // Owned tiles keep the border in the owner's own color rather than the pale art tint.
    border: mix(fill, owner, 0.88),
    villageBorder: mix(fill, owner, 0.52),
    accent: mix(fill, icon, 0.95),
  };
}

/** A crop field: a tight row of four wheat stalks that curve outward from the middle. */
function drawFarmland(g: Graphics, c: Point, art: ArtColors): void {
  // `bend` is how far each stalk leans away from the center: -1 is the far left, 1 the far right.
  const stalks: [number, number][] = [
    [-9, -1],
    [-3, -0.4],
    [3, 0.4],
    [9, 1],
  ];
  // Furrows in the soil under the plants.
  for (const dy of [13, 16.5]) {
    g.moveTo(c.x - 12, c.y + dy)
      .lineTo(c.x + 12, c.y + dy)
      .stroke({ width: 1.2, color: art.faint, cap: 'round' });
  }
  for (const [dx, bend] of stalks) drawWheat(g, c.x + dx, c.y + 10, bend, art.crop);
}

/**
 * One wheat plant growing up from (x, y). The stem curves in the direction of `bend`
 * (negative = left, positive = right) and the ear on top tilts further the same way.
 */
function drawWheat(g: Graphics, x: number, y: number, bend: number, color: number): void {
  const scale = 0.8;
  // Plant-local coordinates (up is negative y), rotated by `angle` about an origin.
  const place =
    (ox: number, oy: number, angle: number) =>
    (px: number, py: number): [number, number] => [
      ox + (px * Math.cos(angle) - py * Math.sin(angle)) * scale,
      oy + (px * Math.sin(angle) + py * Math.cos(angle)) * scale,
    ];
  const lean = bend * 0.14;
  const base = place(x, y, lean);
  const tip = base(bend * 3.5, -12);
  const ear = place(tip[0], tip[1], lean + bend * 0.3);

  g.moveTo(x, y).quadraticCurveTo(...base(0, -6), ...tip);
  g.stroke({ width: 1.4, color, cap: 'round', join: 'round' });
  // The ear: tightly stacked grain pairs angled up and out, with one at the tip.
  for (const level of [5, 2.6, 0.2, -2.2]) {
    g.moveTo(...ear(0, level)).lineTo(...ear(-1.7, level - 3));
    g.moveTo(...ear(0, level)).lineTo(...ear(1.7, level - 3));
  }
  g.moveTo(...ear(0, -3.5)).lineTo(...ear(0, -7));
  g.stroke({ width: 2.2, color, cap: 'round', join: 'round' });
}

/**
 * Two cottages with steep gabled roofs, one with a chimney. Coordinates are offsets from
 * the hex center and stay within the progress ring. `cutout` is the tile's fill color,
 * used to carve doorways.
 */
function drawVillage(g: Graphics, c: Point, art: ArtColors, cutout: number): void {
  // Drawn smaller than a castle so the two read differently at a glance. Scaled about the
  // art's own center, and nudged up so the cottages are not crowded toward the tile's bottom.
  const k = 0.82;
  const at = (x: number, y: number): [number, number] => [c.x + x * k, c.y + 3 + (y - 3) * k - 2.5];
  const rect = (x: number, y: number, w: number, h: number) => g.rect(...at(x, y), w * k, h * k);
  // Large cottage with a chimney.
  rect(-5.5, -4, 2, 4).fill(art.roof);
  rect(-14, 3, 12, 9).fill(art.wall);
  g.poly([...at(-16, 3), ...at(-8, -6), ...at(0, 3)]).fill(art.roof);
  rect(-9, 7, 4, 5).fill(cutout);
  // A lit window in the gable, and a wisp of smoke from the chimney.
  rect(-9.5, -1.5, 3, 3).fill(art.accent);
  g.circle(...at(-4.5, -7.5), 1.6 * k).fill(art.faint);
  g.circle(...at(-3.2, -10.5), 1.2 * k).fill(art.faint);
  // Small cottage.
  rect(3, 6, 10, 6).fill(art.wall);
  rect(5, 7.5, 2.4, 2.4).fill(art.accent);
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
  // Arrow slits in the towers and keep.
  for (const x of [-13, 11]) g.rect(...at(x, -1), 2, 5).fill(cutout);
  g.rect(...at(-1, -1), 2, 4.5).fill(cutout);
  // Gate arch.
  g.rect(...at(-2.5, 6), 5, 6).fill(cutout);
  g.circle(...at(0, 6), 2.5).fill(cutout);
  // Flag.
  g.moveTo(...at(0, -6))
    .lineTo(...at(0, -15))
    .stroke({ width: 1.2, color: art.roof });
  g.poly([...at(0, -15), ...at(6, -12.5), ...at(0, -10)]).fill(art.accent);
}
