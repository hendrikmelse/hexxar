import { Application, Container, Graphics, Text } from 'pixi.js';
import {
  generationInterval,
  type ExecutedMove,
  type Vision,
  hexKey,
  ownedFarmNeighbors,
  isGenerationPaused,
  type Hex,
  type Order,
  type Tile,
} from '@hexxar/shared';
import { playSound } from './audio/audio.js';
import { Clouds, cloudsMerge, drawsMerge, isBigCloud, type Cover } from './clouds.js';
import { visionFor, type GameView } from './game.js';
import { HEX_SIZE, hexCorners, hexToPixel, pixelToHex, type Point } from './layout.js';

/** Distinct, flat player colors, assigned by player order. */
const PLAYER_COLORS = [
  0x4f9dff, // blue
  0xff6b6b, // red
  0xffd166, // yellow
  0x3fd35b, // green
  0xa77bff, // purple
  0xff8a2b, // orange
  0x2ed9e6, // cyan
  0xf05bd0, // magenta
  0xc9e63a, // lime
  0xb8803f, // brown
  0xffb3c7, // pale pink
  0x5a5cf0, // indigo
];

/** The sea: land floats on it, and lakes are the holes in the board. */
const WATER = 0x0e1c27;
/** What owned tiles are tinted from, so owner colors look the same wherever they are. */
const OWNED_BASE = 0x14161c;
/** Unclaimed land: green fields, packed earth around a village, grey flagstones for a city. */
const NEUTRAL_FILL = { farmland: 0x2a3a2c, village: 0x3a382f, city: 0x3a3e46 } as const;
const NEUTRAL_ICON = 0xaab3c8;
/** What a tile hidden by fog is drawn on, under its clouds. */
const FOG_GROUND = 0x16212d;
/** A thin grey line around the board, a few pixels out from the land (also around lakes). */
const COAST_COLOR = 0x3c4656;
const COAST_GAP = 3.5;
const COAST_WIDTH = 1.25;
/** Growing a hexagon's corners by this much moves its edges out by 1 (the edge is 0.866 of the corner distance). */
const EDGE_TO_CORNER = 1 / Math.cos(Math.PI / 6);
/** How long an army takes to walk from one tile to the next (less on very fast ticks). */
const MOVE_MS = 320;
/** How far through its walk an army is when the tile it is walking onto changes. */
const LAND_AT = 0.8;
/** Armies that meet: how far through the walk they touch, and when the fight is over. */
const CLASH_AT = 0.36;
const CLASH_END = 0.5;
/** An army attacking a held tile: how far through its walk it hits, and when the fight is over. */
const BATTLE_AT = 0.4;
const BATTLE_END = 0.75;
const BATTLE_LAND_AT = 0.7;
/** 0 is constant speed, 1 a full ease in and out. */
const EASE = 1.3;
const TOKEN_RADIUS = 12;
/** The dark edge that keeps arrows readable on any tile. */
const ARROW_OUTLINE = 0x0a0e14;
/** A troop count pops to this size when it goes up, then settles back over `POP_MS`. */
const POP_SCALE = 1.18;
const POP_MS = 300;
/** How far through the pop the number is at its biggest. */
const POP_PEAK = 0.35;
/** The generation ring: a new segment pops for this long, and a completed ring pops then fades. */
const RING_POP_MS = 300;
/** How long the numbers floating up from a battle last, and the grey of neutral troops. */
const FLOAT_MS = 1000;
const NEUTRAL_TROOPS = 0xa3abb8;
const RING_FINISH_MS = 750;
/** A segment leaving the ring: it pops out, then the rest slide round to fill its place. */
const RING_SHRINK_MS = 700;
const RING_SHRINK_POP_END = 0.4;
/** A segment joining the ring: the others slide apart until this far through, then it pops in. */
const RING_GROW_SLIDE_END = 0.5;
/** How far through the finish the last segment is at its biggest, and where the fade begins. */
const RING_FINISH_POP_END = 0.4;
/** Thickness of the outline around a group of tiles of one owner. */
const OUTLINE_WIDTH = 1.3;
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
const SEGMENT_WIDTH = 2.5;
/** How much longer a popping segment gets, as a share of the gap between segments. */
const SEGMENT_GROWTH = 0.75;
/** Inset of the inner wall border from the hex edge: far enough out to clear the progress ring. */
const WALL_INSET = 4.5;
/** The wedges that fill the corners of a city's inner border. */
const CORNER_WEDGE_RADIUS = 5;
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

/** An army on its way: a token travelling from one tile center to another. */
interface Flight {
  readonly token: Container;
  readonly label: Text;
  readonly from: Point;
  readonly to: Point;
  readonly color: number;
  readonly started: number;
  readonly duration: number;
  /** Whose army it is. */
  readonly player: string;
  /** The key of the tile it is heading for. */
  readonly target: string;
  readonly game: GameView;
  /** How far through its walk the target tile is redrawn (just before the army gets there). */
  readonly landAt: number;
  /** Set when it meets an army coming the other way: what is left of this one afterwards. */
  readonly clash?: { readonly survivors: number };
  /** Set when it attacks a tile someone holds: whether the attack takes the tile. */
  readonly battle?: {
    readonly won: boolean;
    /** The attacking army's size once the fight is over, and how many it lost. */
    readonly remaining: number;
    readonly lost: number;
    readonly defenderLost: number;
  };
  /** Only one of the two armies in a clash draws the burst. */
  readonly drawsBurst: boolean;
  /** The target tile has been redrawn. */
  landed: boolean;
}

interface TileView {
  readonly shape: Graphics;
  /** The generation ring, apart from the tile so it can animate by itself. */
  readonly ring: Graphics;
  readonly label: Text;
  /** Who the tile was drawn as belonging to (a tile an army is walking onto lags behind the game). */
  owner: string | null;
  /** What the ring last showed, to tell what changed. */
  ringFilled: number;
  ringSegments: number;
}

/** What a tile's generation ring should show. */
interface RingSpec {
  readonly center: Point;
  readonly color: number;
  readonly segments: number;
  readonly filled: number;
  readonly paused: boolean;
}

type RingAnim =
  | { kind: 'pop'; start: number; from: number; to: number; spec: RingSpec }
  /** A full ring: the last segment pops, then every segment fades away together. */
  | { kind: 'finish'; start: number; spec: RingSpec; final: RingSpec | null }
  /** One segment fewer: the last pops out of existence and the others slide over. */
  | { kind: 'shrink'; start: number; spec: RingSpec; final: RingSpec }
  /** One segment more: the others slide apart and a new one pops in. */
  | { kind: 'grow'; start: number; spec: RingSpec; final: RingSpec };

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
  private readonly coastLayer = new Graphics();
  private readonly tileLayer = new Container();
  private readonly fogLayer = new Container();
  private readonly clouds: Clouds;
  /** What the player can see (`null`: everything), as of the last time it was worked out. */
  private vision: Map<string, Vision> | null = null;
  private readonly ringAnims = new Map<TileView, RingAnim>();
  private readonly floaters = new Set<{ text: Text; at: Point; started: number }>();
  /** Troop labels that are popping, and when each started. */
  private readonly pops = new Map<Text, number>();
  private readonly queueLayer = new Graphics();
  private readonly pendingLayer = new Graphics();
  private readonly selectionLayer = new Graphics();
  private bottomInset = 0;
  private readonly pointerLayer = new Graphics();
  /** The tiles a lesson's demonstration pointer drags across, and when it started. */
  private pointerPath: readonly Hex[] = [];
  private pointerStarted = 0;
  private readonly highlightLayer = new Graphics();
  /** Tiles a lesson is pointing at. */
  private highlights: readonly Hex[] = [];
  private readonly moveLayer = new Container();
  private readonly trails = new Graphics();
  private readonly bursts = new Graphics();
  private readonly introLayer = new Container();
  private readonly flights = new Set<Flight>();
  /** Tiles whose redraw waits for an army to arrive. */
  private readonly held = new Set<string>();
  private stopIntroFrame: (() => void) | null = null;
  private readonly views = new Map<string, TileView>();
  /** Pixel density the troop labels are currently rendered at. */
  private textResolution = window.devicePixelRatio || 1;

  private constructor(
    private readonly app: Application,
    private readonly handlers: OrderDragHandlers,
  ) {
    this.world.addChild(
      this.coastLayer,
      this.tileLayer,
      this.fogLayer,
      this.highlightLayer,
      this.queueLayer,
      this.pendingLayer,
      this.selectionLayer,
      this.moveLayer,
      this.introLayer,
      this.pointerLayer,
    );
    this.moveLayer.addChild(this.trails, this.bursts);
    app.stage.addChild(this.world);
    this.clouds = new Clouds(this.fogLayer);
    app.ticker.add(() => {
      this.clouds.update(app.ticker.deltaMS / 1000);
      this.animatePops();
      this.animateRings();
      this.animateFlights();
      this.animateFloaters();
      this.drawHighlights();
      this.drawPointer();
    });
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
  /** When (performance.now) an army last reached its tile and the tile changed to match. */
  lastLandAt = 0;

  /** How many armies are still on their way to a tile that will change when they get there. */
  get pendingLandings(): number {
    let waiting = 0;
    for (const flight of this.flights) if (!flight.landed) waiting++;
    return waiting;
  }

  setAll(game: GameView): void {
    const fresh = this.views.size === 0;
    this.pops.clear();
    this.ringAnims.clear();
    this.clearFlights();
    this.tileLayer.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.views.clear();
    // A whole new board starts with its fog in place. A fresh look at the same board (the match
    // ended, or someone surrendered, and everything is revealed) keeps the clouds, so they can fade.
    if (fresh) this.clouds.clear();
    this.drawCoast(game);
    this.vision = visionFor(game);
    for (const tile of Object.values(game.tiles)) this.updateTile(tile, game);
    this.coverTiles(game, Object.keys(game.tiles), fresh);
    if (fresh && this.views.size > 0) this.fitToBoard();
  }

  /** Point at some tiles (a pulsing outline), or at none. Used by the tutorial. */
  setHighlights(hexes: readonly Hex[]): void {
    this.highlights = hexes;
    if (hexes.length === 0) this.highlightLayer.clear();
  }

  /**
   * Show how to give an order: a pointer presses on the first tile, drags across the rest, and
   * lets go, over and over. Used by the tutorial. An empty path stops it.
   */
  setPointer(path: readonly Hex[]): void {
    this.pointerPath = path.length >= 2 ? path : [];
    this.pointerStarted = performance.now();
    if (this.pointerPath.length === 0) this.pointerLayer.clear();
  }

  private drawPointer(): void {
    const path = this.pointerPath;
    if (path.length < 2) return;
    const hops = path.length - 1;
    // One demonstration: fade in, press, drag the whole line in one smooth sweep, let go, fade.
    const APPEAR = 450;
    const PRESS = 180;
    const DRAG = 600 + 380 * hops;
    const RELEASE = 200;
    const REST = 600;
    const total = APPEAR + PRESS + DRAG + RELEASE + REST;
    const t = (performance.now() - this.pointerStarted) % total;
    const centers = path.map((hex) => hexToPixel(hex));
    const k = Math.max(1, 0.5 / this.world.scale.x);
    const g = this.pointerLayer;
    g.clear();

    // How far along the line it is (0 to 1), how much it fades, and how pressed it looks.
    let along = 0;
    let alpha = 1;
    let press = 0;
    if (t < APPEAR) {
      alpha = t / APPEAR;
    } else if (t < APPEAR + PRESS) {
      press = (t - APPEAR) / PRESS;
    } else if (t < APPEAR + PRESS + DRAG) {
      press = 1;
      const u = (t - APPEAR - PRESS) / DRAG;
      along = u * u * (3 - 2 * u);
    } else if (t < APPEAR + PRESS + DRAG + RELEASE) {
      along = 1;
      press = 1 - (t - APPEAR - PRESS - DRAG) / RELEASE;
    } else {
      along = 1;
      alpha = 1 - (t - APPEAR - PRESS - DRAG - RELEASE) / REST;
    }

    // The point that far along the whole line (by distance, so the speed is even).
    const lengths = centers
      .slice(1)
      .map((c, i) => Math.hypot(c.x - centers[i]!.x, c.y - centers[i]!.y));
    const wanted = along * lengths.reduce((sum, l) => sum + l, 0);
    let travelled = 0;
    let hop = 0;
    while (hop < hops - 1 && travelled + lengths[hop]! < wanted) travelled += lengths[hop++]!;
    const from = centers[hop]!;
    const to = centers[hop + 1]!;
    const local = lengths[hop]! > 0 ? Math.min(1, (wanted - travelled) / lengths[hop]!) : 1;
    const x = from.x + (to.x - from.x) * local;
    const y = from.y + (to.y - from.y) * local;

    // The line it has dragged so far.
    if (along > 0) {
      g.moveTo(centers[0]!.x, centers[0]!.y);
      for (let i = 1; i <= hop; i++) g.lineTo(centers[i]!.x, centers[i]!.y);
      g.lineTo(x, y);
      g.stroke({ width: 6 * k, color: 0xffffff, alpha: 0.45 * alpha, cap: 'round', join: 'round' });
    }
    // The pointer itself: an arrow cursor whose tip is on the spot. It shrinks a lot when pressed.
    const s = (1.08 - 0.38 * press) * k;
    const cursor = [0, 0, 0, 20, 5, 15.5, 8.6, 23, 12, 21.5, 8.6, 14.5, 15, 14].map((v, i) =>
      i % 2 === 0 ? x + v * s : y + v * s,
    );
    g.poly(cursor.map((v, i) => (i % 2 === 0 ? v + 2 * k : v + 3 * k))).fill({
      color: 0x000000,
      alpha: 0.3 * alpha,
    });
    g.poly(cursor)
      .fill({ color: 0xffffff, alpha })
      .stroke({ width: 1.8 * k, color: 0x10151c, alpha, join: 'round' });
  }

  private drawHighlights(): void {
    if (this.highlights.length === 0) return;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260);
    const g = this.highlightLayer;
    g.clear();
    for (const hex of this.highlights) {
      const center = hexToPixel(hex);
      g.poly(hexCorners(center, -3)).stroke({
        width: 7,
        color: 0xffd966,
        alpha: 0.12 + 0.18 * pulse,
      });
      g.poly(hexCorners(center, 0)).stroke({
        width: 3,
        color: 0xffd966,
        alpha: 0.55 + 0.45 * pulse,
      });
    }
  }

  /** How much of a tile the player sees. */
  private levelOf(key: string): 'full' | 'far' | 'hidden' {
    if (this.vision === null) return 'full';
    return this.vision.get(key) ?? 'hidden';
  }

  /**
   * Work out what the player can see now, and redraw the tiles whose view changed (their clouds
   * come or go with them). A tile an army is still walking onto counts as it was until it lands,
   * so the fog does not lift before the army arrives.
   */
  refreshVision(game: GameView): void {
    // Who owns what is known the moment the tick arrives, so the fog reacts at once, without
    // waiting for an army to finish walking onto its tile.
    const next = visionFor(game);
    const previous = this.vision;
    this.vision = next;
    const changed: string[] = [];
    for (const key of this.views.keys()) {
      const before = previous === null ? 'full' : (previous.get(key) ?? 'hidden');
      const after = next === null ? 'full' : (next.get(key) ?? 'hidden');
      if (before !== after) changed.push(key);
    }
    if (changed.length === 0) return;
    for (const key of changed) {
      const tile = game.tiles[key];
      if (tile && !this.held.has(key)) this.updateTile(tile, game);
    }
    // A tile's clouds also depend on which of its neighbors are in view.
    const affected = new Set(changed);
    for (const key of changed) {
      const tile = game.tiles[key];
      if (!tile) continue;
      for (const [dq, dr] of EDGE_NEIGHBORS)
        affected.add(hexKey({ q: tile.q + dq, r: tile.r + dr }));
    }
    this.coverTiles(game, affected, false);
  }

  /** Put clouds over the tiles the player cannot (fully) see, and take them off the ones they can. */
  private coverTiles(game: GameView, keys: Iterable<string>, instant: boolean): void {
    for (const key of keys) {
      const tile = game.tiles[key];
      if (!tile) continue;
      const level = this.levelOf(key);
      const center = hexToPixel(tile);
      let cover: Cover | null = null;
      if (level === 'hidden') {
        // Neighbors that are hidden too sometimes share one bigger cloud with this tile.
        const joins: Point[] = [];
        let hiddenNeighbors = 0;
        let lean = { x: 0, y: 0 };
        for (const [dq, dr] of EDGE_NEIGHBORS) {
          const next = { q: tile.q + dq, r: tile.r + dr };
          if (this.levelOf(hexKey(next)) !== 'hidden' || !game.tiles[hexKey(next)]) continue;
          const there = hexToPixel(next);
          hiddenNeighbors++;
          lean = { x: lean.x + there.x - center.x, y: lean.y + there.y - center.y };
          if (!drawsMerge(tile, next) || !cloudsMerge(tile, next)) continue;
          joins.push({ x: there.x - center.x, y: there.y - center.y });
        }
        // A tile surrounded by hidden ground sometimes anchors a still bigger cloud.
        const swell = isBigCloud(tile, hiddenNeighbors)
          ? { x: lean.x / hiddenNeighbors, y: lean.y / hiddenNeighbors }
          : null;
        cover = { kind: 'hidden', joins, swell };
      } else if (level === 'far') {
        // Keep clear the edges that face tiles the player sees in full: that is where the
        // owner's color and the kind of tile show through.
        let nx = 0;
        let ny = 0;
        for (const [dq, dr] of EDGE_NEIGHBORS) {
          if (this.levelOf(hexKey({ q: tile.q + dq, r: tile.r + dr })) !== 'full') continue;
          const toward = hexToPixel({ q: tile.q + dq, r: tile.r + dr });
          nx += toward.x - center.x;
          ny += toward.y - center.y;
        }
        const length = Math.hypot(nx, ny) || 1;
        cover = { kind: 'far', away: { x: -nx / length, y: -ny / length } };
      }
      this.clouds.cover(key, tile.q, tile.r, center, cover, instant);
    }
  }

  /**
   * The grey line around the land. Every tile is drawn a little bigger in the line's color, then
   * a bit smaller in the water's color: what is left of the first is a thin ring, offset out from
   * the coast, whose corners and joints are all clean.
   */
  private drawCoast(game: GameView): void {
    const g = this.coastLayer;
    g.clear();
    const centers = Object.values(game.tiles).map((tile) => hexToPixel(tile));
    for (const center of centers) {
      g.poly(hexCorners(center, -(COAST_GAP + COAST_WIDTH) * EDGE_TO_CORNER)).fill(COAST_COLOR);
    }
    for (const center of centers) {
      g.poly(hexCorners(center, -COAST_GAP * EDGE_TO_CORNER)).fill(WATER);
    }
  }

  /** Pop a troop label bigger for a moment, to catch the eye when its number goes up. */
  private pop(label: Text): void {
    if (prefersReducedMotion()) return;
    this.pops.set(label, performance.now());
  }

  private animatePops(): void {
    if (this.pops.size === 0) return;
    const now = performance.now();
    for (const [label, started] of this.pops) {
      const t = (now - started) / POP_MS;
      if (t >= 1) {
        label.scale.set(1);
        this.pops.delete(label);
      } else {
        label.scale.set(1 + (POP_SCALE - 1) * popCurve(t, POP_PEAK));
      }
    }
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
      // A tile an army is walking onto is drawn once it arrives.
      if (tile && !this.held.has(key)) this.updateTile(tile, game);
    }
  }

  /**
   * Show the armies that set off this tick walking to where they are going. The tiles they walk
   * onto keep their old look until the army arrives, then change (and pop if they grew).
   */
  playMoves(moves: readonly ExecutedMove[], game: GameView): void {
    if (!game.config || prefersReducedMotion()) return;
    const duration = Math.min(MOVE_MS, game.config.tickMs * 0.6);
    // A clash needs more time: the armies walk to the middle, fight, and the winner walks on.
    const clashDuration = Math.min(MOVE_MS * 1.7, game.config.tickMs * 0.9);
    for (const move of moves) {
      if (move.troops <= 0) continue;
      const color = playerColor(game, move.player) ?? 0xffffff;
      if (move.player === game.playerId) playSound('army.depart');
      const token = new Container();
      // A solid disc in the player's color on a soft dark shadow.
      const disc = new Graphics()
        .circle(0, 3.5, TOKEN_RADIUS + 2)
        .fill({ color: 0x000000, alpha: 0.18 })
        .circle(0, 3, TOKEN_RADIUS + 0.5)
        .fill({ color: 0x000000, alpha: 0.35 })
        .circle(0, 0, TOKEN_RADIUS)
        .fill(color);
      const label = new Text({
        text: String(move.troops),
        style: {
          fontSize: 13,
          fontWeight: '800',
          fill: 0xffffff,
          stroke: { color: 0x0e1016, width: 3.5, join: 'round' },
          fontFamily: 'system-ui, sans-serif',
        },
        resolution: this.textResolution * 2,
      });
      label.anchor.set(0.5);
      token.addChild(disc, label);
      this.moveLayer.addChild(token);
      // The army has left: its tile is down to the one troop that stays, even if the tile itself
      // is being held back (two armies swapping places each leave from a tile the other is
      // heading for).
      const source = this.views.get(hexKey(move.from));
      if (source && source.label.text !== '') source.label.text = '1';
      const target = hexKey(move.to);
      this.held.add(target);
      const winner = move.clash !== undefined && move.clash.survivors > 0;
      // An army walking onto a tile with troops on it (that is not its own) has a battle to fight.
      const held = this.views.get(target);
      const defenders = held && held.label.text !== '' ? Number(held.label.text) : 0;
      const battle =
        !move.clash && defenders > 0 && held?.owner !== move.player
          ? battleOutcome(move.troops, defenders, game.tiles[target], move.player)
          : undefined;
      const from = hexToPixel(move.from);
      const to = hexToPixel(move.to);
      if (battle) {
        // What each side lost floats up in its own color when the armies hit: from the army (where
        // it stops at the tile's edge) and from the number on the tile.
        const delay = BATTLE_AT * clashDuration;
        const owner = held?.owner ?? null;
        const defenderColor = (owner === null ? null : playerColor(game, owner)) ?? NEUTRAL_TROOPS;
        const stop = { x: from.x + (to.x - from.x) * 0.68, y: from.y + (to.y - from.y) * 0.68 };
        this.floatLoss(battle.lost, color, stop, delay);
        this.floatLoss(battle.defenderLost, defenderColor, to, delay);
      }
      this.flights.add({
        token,
        label,
        from: hexToPixel(move.from),
        to: hexToPixel(move.to),
        color,
        started: performance.now(),
        duration: move.clash || battle ? clashDuration : duration,
        player: move.player,
        target,
        game,
        // The loser's tile (the winner's start) is settled once the fight is over.
        landAt: move.clash ? (winner ? 0.85 : CLASH_END) : battle ? BATTLE_LAND_AT : LAND_AT,
        ...(move.clash ? { clash: move.clash } : {}),
        ...(battle ? { battle } : {}),
        drawsBurst:
          battle !== undefined || (move.clash !== undefined && hexKey(move.from) < target),
        landed: false,
      });
    }
    this.animateFlights();
  }

  /** A number that rises slowly from a spot on the board and fades: troops lost in a battle. */
  private floatLoss(amount: number, color: number, at: Point, delayMs: number): void {
    if (amount <= 0) return;
    const text = new Text({
      text: `-${amount}`,
      style: {
        fontSize: 17,
        fontWeight: '800',
        fill: color,
        stroke: { color: 0x0e1016, width: 4, join: 'round' },
        fontFamily: 'system-ui, sans-serif',
      },
      resolution: this.textResolution * 2,
    });
    text.anchor.set(0.5);
    text.alpha = 0;
    this.moveLayer.addChild(text);
    this.floaters.add({ text, at, started: performance.now() + delayMs });
  }

  private animateFloaters(): void {
    if (this.floaters.size === 0) return;
    const now = performance.now();
    const k = Math.max(1, 0.55 / this.world.scale.x);
    for (const floater of this.floaters) {
      const t = (now - floater.started) / FLOAT_MS;
      if (t >= 1) {
        this.floaters.delete(floater);
        floater.text.destroy();
        continue;
      }
      if (t < 0) continue;
      const { text, at } = floater;
      // It rises steadily rather than easing out, and fades over its last stretch.
      text.position.set(at.x, at.y - (10 + 13.6 * t) * k);
      text.scale.set(k * (1 + 0.3 * popCurve(Math.min(1, t * 2.7), 0.5)));
      text.alpha = Math.min(t / 0.1, 1 - smoothstep(Math.max(0, (t - 0.5) / 0.5)));
    }
  }

  /** The sound of an army arriving: a tile taken, an attack failing, a tile lost or held. */
  private landingSound(flight: Flight, oldOwner: string | null, newOwner: string | null): void {
    const me = flight.game.playerId;
    if (me === null || flight.clash) return;
    if (flight.player === me) {
      if (flight.battle && !flight.battle.won) playSound('tile.captureFailed');
      else if (newOwner === me && oldOwner !== me) playSound('tile.capture');
    } else if (oldOwner === me) {
      playSound(newOwner === me ? 'tile.defended' : 'tile.lost');
    }
  }

  private animateFlights(): void {
    if (this.flights.size === 0) return;
    const now = performance.now();
    // On a zoomed-out board the world is scaled down; keep the armies readable.
    const k = Math.max(1, 0.55 / this.world.scale.x);
    this.trails.clear();
    this.bursts.clear();
    const finished: Flight[] = [];
    for (const flight of this.flights) {
      const t = Math.min(1, (now - flight.started) / flight.duration);
      // The tile changes a moment before the army gets there, so there is no wait at the end.
      if (!flight.landed && t >= flight.landAt) {
        flight.landed = true;
        this.lastLandAt = performance.now();
        const oldOwner = this.views.get(flight.target)?.owner ?? null;
        this.held.delete(flight.target);
        const tile = flight.game.tiles[flight.target];
        if (tile && !this.held.has(flight.target)) this.updateTiles([tile], flight.game);
        this.landingSound(flight, oldOwner, flight.game.tiles[flight.target]?.owner ?? null);
        // Arriving can open up new ground to see.
        this.refreshVision(flight.game);
      }
      const { clash } = flight;
      const beaten = clash !== undefined && clash.survivors === 0;
      if (t >= 1 || (beaten && t >= CLASH_END)) {
        finished.push(flight);
        continue;
      }
      const dx = flight.to.x - flight.from.x;
      const dy = flight.to.y - flight.from.y;
      let e: number;
      let scale = k;
      if (flight.battle) {
        // Up to the tile's edge, then the fight: a beaten army swells and fades where it stands,
        // a winning one pushes in and gives way to the tile it has taken.
        const fight = Math.min(1, Math.max(0, (t - BATTLE_AT) / (BATTLE_END - BATTLE_AT)));
        if (t >= BATTLE_AT) {
          // The army shrinks to what survived.
          flight.label.text = String(flight.battle.remaining);
        }
        if (t < BATTLE_AT) {
          e = 0.8 * smoothstep(t / BATTLE_AT);
        } else if (flight.battle.won) {
          e = 0.8 + 0.2 * fight;
          scale = k * (1 + 0.25 * popCurve(fight, 0.4));
          flight.token.alpha =
            t < BATTLE_LAND_AT ? 1 : 1 - smoothstep((t - BATTLE_LAND_AT) / (1 - BATTLE_LAND_AT));
        } else {
          e = 0.8;
          scale = k * (1 + 0.6 * fight);
          flight.token.alpha = 1 - fight;
        }
      } else if (!clash) {
        // A gentle ease: a little slower at both ends, never a stop.
        const smooth = t * t * (3 - 2 * t);
        e = t + (smooth - t) * EASE;
      } else if (t < CLASH_AT) {
        // Both armies head for the middle of the two tiles, picking up speed.
        e = 0.5 * (t / CLASH_AT) ** 1.3;
      } else {
        e = t < CLASH_END ? 0.5 : 0.5 + (0.5 * (t - CLASH_END)) / (1 - CLASH_END);
        const fight = Math.min(1, (t - CLASH_AT) / (CLASH_END - CLASH_AT));
        if (beaten) {
          // The loser is knocked out: it swells and fades away on the spot.
          scale = k * (1 + 0.6 * fight);
          flight.token.alpha = 1 - fight;
        } else {
          // The winner shows what is left of it, and carries on a little bigger for a moment.
          flight.label.text = String(clash!.survivors);
          scale = k * (1 + 0.3 * popCurve(Math.min(1, (t - CLASH_AT) / 0.25), 0.4));
        }
      }
      const x = flight.from.x + dx * e;
      const y = flight.from.y + dy * e;
      flight.token.position.set(x, y);
      flight.token.scale.set(scale);
      this.trails
        .moveTo(flight.from.x, flight.from.y)
        .lineTo(x, y)
        .stroke({ width: 5 * k, color: flight.color, alpha: 0.3 * (1 - t), cap: 'round' });
      if (flight.drawsBurst) this.drawBurst(flight, t, k);
    }
    for (const flight of finished) {
      this.flights.delete(flight);
      flight.token.destroy({ children: true });
    }
  }

  /** The flash where two armies meet: a ring spreading out, and sparks flying off. */
  private drawBurst(flight: Flight, t: number, k: number): void {
    const battle = flight.battle !== undefined;
    const p = (t - ((battle ? BATTLE_AT : CLASH_AT) - 0.04)) / 0.4;
    if (p <= 0 || p >= 1) return;
    // Armies meeting halfway fight in the middle; an attack fights on the tile attacked.
    const x = battle ? flight.to.x : (flight.from.x + flight.to.x) / 2;
    const y = battle ? flight.to.y : (flight.from.y + flight.to.y) / 2;
    const fade = 1 - p;
    this.bursts
      .circle(x, y, (6 + 26 * p) * k)
      .stroke({ width: 3 * k * fade + 0.5, color: 0xffe2a0, alpha: 0.85 * fade });
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI / 4) * i + 0.4;
      const inner = (8 + 14 * p) * k;
      const outer = inner + 7 * k * fade;
      this.bursts
        .moveTo(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner)
        .lineTo(x + Math.cos(angle) * outer, y + Math.sin(angle) * outer)
        .stroke({ width: 2 * k, color: 0xffffff, alpha: 0.9 * fade, cap: 'round' });
    }
  }

  private clearFlights(): void {
    for (const flight of this.flights) flight.token.destroy({ children: true });
    this.flights.clear();
    for (const floater of this.floaters) floater.text.destroy();
    this.floaters.clear();
    this.held.clear();
    this.trails.clear();
    this.bursts.clear();
  }

  private updateTile(tile: Tile, game: GameView): void {
    const key = hexKey(tile);
    let view = this.views.get(key);
    const existed = view !== undefined;
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
      view = {
        shape: new Graphics(),
        ring: new Graphics(),
        label,
        owner: tile.owner,
        ringFilled: 0,
        ringSegments: 0,
      };
      this.tileLayer.addChild(view.shape, view.ring, view.label);
      this.views.set(key, view);
    }

    const center = hexToPixel(tile);
    const level = this.levelOf(key);
    const owner = playerColor(game, tile.owner);
    const fill =
      level === 'hidden'
        ? FOG_GROUND
        : owner === null
          ? NEUTRAL_FILL[tile.type]
          : mix(OWNED_BASE, owner, OWNED_FILL);
    const shape = view.shape;
    shape.clear();
    view.owner = tile.owner;
    if (level === 'hidden') {
      // Nothing is known about this tile: just ground, under the clouds.
      shape.poly(hexCorners(center, TILE_INSET + 1)).fill(fill);
      this.hideDetails(view);
      return;
    }
    // Neutral tiles are drawn a pixel smaller, so they sit further apart than a connected group.
    const corners = hexCorners(center, owner === null ? TILE_INSET + 1 : TILE_INSET);
    shape.poly(corners).fill(fill);
    // Outline only the edges on the border of a group of same-owner tiles. The line is drawn just
    // inside the true hex boundary (the whole stroke on this tile's side), so where two groups
    // touch, each keeps its own line instead of one covering the other.
    if (owner !== null) {
      const boundary = hexCorners(center, 0);
      const isBorder = (edge: number): boolean => {
        const [dq, dr] = EDGE_NEIGHBORS[edge]!;
        const key = hexKey({ q: tile.q + dq, r: tile.r + dr });
        // A neighbor an army is still walking onto is shown as it was, so the border stays put
        // until that tile changes hands on screen.
        const neighbor = this.held.has(key) ? this.views.get(key) : game.tiles[key];
        return neighbor?.owner !== tile.owner;
      };
      const inward = OUTLINE_WIDTH / 2;
      // Where a moved-in line ends so it meets the next one: a 120 degree corner is cut back by
      // this much, and where the border carries on along a neighbor's edge it reaches this far past.
      const miter = inward * Math.tan(Math.PI / 6);
      for (let i = 0; i < 6; i++) {
        if (!isBorder(i)) continue;
        const j = (i + 1) % 6;
        // Edge i faces 60 * i degrees; move inward, against that direction.
        const nx = Math.cos((Math.PI / 3) * i);
        const ny = Math.sin((Math.PI / 3) * i);
        const ax = boundary[2 * i]! - nx * inward;
        const ay = boundary[2 * i + 1]! - ny * inward;
        const bx = boundary[2 * j]! - nx * inward;
        const by = boundary[2 * j + 1]! - ny * inward;
        const length = Math.hypot(bx - ax, by - ay);
        const ux = (bx - ax) / length;
        const uy = (by - ay) / length;
        const startCut = isBorder((i + 5) % 6) ? miter : -miter;
        const endCut = isBorder(j) ? -miter : miter;
        shape
          .moveTo(ax + ux * startCut, ay + uy * startCut)
          .lineTo(bx + ux * endCut, by + uy * endCut)
          .stroke({ width: OUTLINE_WIDTH, color: owner, cap: 'round' });
      }
    }

    // Tile type art sits behind the troop count. Villages and cities have a defensive bonus,
    // shown as an inner border (fainter for villages, riveted for cities).
    // On owned tiles the art is a pale tint of the owner color so it stands out from the fill.
    const iconColor = owner === null ? NEUTRAL_ICON : mix(owner, 0xffffff, 0.65);
    const art = tileArtColors(fill, iconColor, owner, tile.type);
    if (tile.type === 'farmland') {
      drawFarmland(shape, center, art);
    } else if (tile.type === 'village') {
      shape.poly(hexCorners(center, WALL_INSET)).stroke({ width: 1.5, color: art.border });
      drawVillage(shape, center, art, fill);
    } else {
      const inner = hexCorners(center, WALL_INSET);
      shape.poly(inner).stroke({ width: 1.5, color: art.border });
      // Each interior corner is filled with a wedge of a circle: the whole 120 degree angle.
      for (let i = 0; i < inner.length; i += 2) {
        const x = inner[i]!;
        const y = inner[i + 1]!;
        const toCenter = Math.atan2(center.y - y, center.x - x);
        shape
          .moveTo(x, y)
          .arc(x, y, CORNER_WEDGE_RADIUS, toCenter - Math.PI / 3, toCenter + Math.PI / 3)
          .closePath()
          .fill(art.border);
      }
      drawCastle(shape, center, art, fill);
    }
    if (level === 'far') {
      // Seen from afar: the owner and the kind of tile, but no troops and no production.
      this.hideDetails(view);
      return;
    }
    const previousTroops =
      existed && view.label.text !== '' ? Number(view.label.text) : tile.troops;
    this.updateRing(view, tile, center, owner, game, existed, previousTroops);
    // A new troop (the number going up on someone's tile) gets a little pop.
    view.label.text = String(tile.troops);
    if (tile.owner !== null && tile.troops > previousTroops) this.pop(view.label);
  }

  /** No troop count and no generation ring: what a tile shows when it is not seen up close. */
  private hideDetails(view: TileView): void {
    view.label.text = '';
    view.ring.clear();
    this.ringAnims.delete(view);
    view.ringFilled = 0;
    view.ringSegments = 0;
  }

  /**
   * The ring of segments around an owned tile, one per tick of its generation cycle. Filled
   * segments are progress; at the troop cap the progress is kept but shown dimmed, since it is
   * paused. A newly filled segment pops, and when the last one fills (and a troop is made) the
   * ring pops once more and then every segment fades away together.
   */
  private updateRing(
    view: TileView,
    tile: Tile,
    center: Point,
    owner: number | null,
    game: GameView,
    existed: boolean,
    previousTroops: number,
  ): void {
    const spec = ringSpec(tile, center, owner, game);
    if (!spec) {
      this.ringAnims.delete(view);
      view.ring.clear();
      view.ringFilled = 0;
      view.ringSegments = 0;
      return;
    }
    const previousFilled = view.ringFilled;
    const previousSegments = view.ringSegments;
    view.ringFilled = spec.filled;
    view.ringSegments = spec.segments;

    const running = this.ringAnims.get(view);
    if (running?.kind === 'finish') {
      // Let the finish play out; what comes after it is the newest state.
      running.final = spec;
      return;
    }
    if (
      (running?.kind === 'shrink' || running?.kind === 'grow') &&
      spec.segments === running.final.segments
    ) {
      // Redrawn again (a neighbor changed hands) while it plays: keep playing, ending on the newest.
      running.final = spec;
      return;
    }
    const animate = existed && previousSegments > 0 && !prefersReducedMotion();
    const now = performance.now();
    // The ring starting over means the city has just made a troop, whether or not that troop is
    // still there (it may have marched out on the same tick, leaving the count no higher).
    const startedOver =
      spec.filled < previousFilled &&
      (spec.segments === previousSegments || tile.troops > previousTroops);
    if (animate && !startedOver && spec.segments === previousSegments - 1) {
      const old: RingSpec = { ...spec, segments: previousSegments, filled: previousFilled };
      this.ringAnims.set(view, { kind: 'shrink', start: now, spec: old, final: spec });
    } else if (animate && !startedOver && spec.segments === previousSegments + 1) {
      const old: RingSpec = { ...spec, segments: previousSegments, filled: previousFilled };
      this.ringAnims.set(view, { kind: 'grow', start: now, spec: old, final: spec });
    } else if (animate && startedOver) {
      const full: RingSpec = { ...spec, segments: previousSegments, filled: previousSegments };
      this.ringAnims.set(view, { kind: 'finish', start: now, spec: full, final: spec });
    } else if (animate && spec.segments === previousSegments && spec.filled > previousFilled) {
      this.ringAnims.set(view, {
        kind: 'pop',
        start: now,
        from: previousFilled,
        to: spec.filled,
        spec,
      });
    } else {
      this.ringAnims.delete(view);
      drawRing(view.ring, spec);
      return;
    }
    this.animateRings();
  }

  private animateRings(): void {
    if (this.ringAnims.size === 0) return;
    const now = performance.now();
    for (const [view, anim] of this.ringAnims) {
      const duration =
        anim.kind === 'pop'
          ? RING_POP_MS
          : anim.kind === 'shrink' || anim.kind === 'grow'
            ? RING_SHRINK_MS
            : RING_FINISH_MS;
      const t = (now - anim.start) / duration;
      if (t >= 1) {
        this.ringAnims.delete(view);
        drawRing(view.ring, anim.kind === 'pop' ? anim.spec : (anim.final ?? anim.spec));
        continue;
      }
      if (anim.kind === 'pop') {
        const bump = popCurve(t, POP_PEAK);
        drawRing(view.ring, anim.spec, (i) =>
          i >= anim.from && i < anim.to ? { thick: 1 + 0.5 * bump, longer: bump } : undefined,
        );
      } else if (anim.kind === 'grow') {
        const n = anim.spec.segments;
        // A segment that filled on the same tick pops while all this goes on.
        const filledNow = Math.min(anim.final.filled, n);
        const popFilled = newlyFilled(anim, now, n);
        if (t < RING_GROW_SLIDE_END) {
          // Make room: the segments there are slide apart.
          const u = smoothstep(t / RING_GROW_SLIDE_END);
          drawRing(view.ring, { ...anim.spec, filled: filledNow }, popFilled, false, n + u);
        } else {
          // The new segment swells in, a little past full size, and settles.
          const u = (t - RING_GROW_SLIDE_END) / (1 - RING_GROW_SLIDE_END);
          const size =
            u < 0.6 ? 1.35 * smoothstep(u / 0.6) : 1.35 - 0.35 * smoothstep((u - 0.6) / 0.4);
          drawRing(view.ring, { ...anim.final, filled: filledNow }, (i) =>
            i === n ? { shrink: size } : popFilled(i),
          );
        }
      } else if (anim.kind === 'shrink') {
        const n = anim.spec.segments;
        // A segment that filled on the same tick pops while all this goes on.
        const filled = Math.min(anim.final.filled, n - 1);
        const popFilled = newlyFilled(anim, now, n - 1);
        if (t < RING_SHRINK_POP_END) {
          // The last segment swells and vanishes.
          const u = t / RING_SHRINK_POP_END;
          const grow = u < 0.35 ? 1 + 0.4 * (u / 0.35) : 1.4 * (1 - smoothstep((u - 0.35) / 0.65));
          drawRing(view.ring, { ...anim.spec, filled }, (i) =>
            i === n - 1 ? { shrink: grow } : popFilled(i),
          );
        } else {
          // The rest slide round to share the ring out again.
          const u = smoothstep((t - RING_SHRINK_POP_END) / (1 - RING_SHRINK_POP_END));
          drawRing(view.ring, { ...anim.spec, segments: n - 1, filled }, popFilled, false, n - u);
        }
      } else if (t < RING_FINISH_POP_END) {
        // Every segment is in, and the last one pops like any other.
        const bump = popCurve(t / RING_FINISH_POP_END, POP_PEAK);
        const last = anim.spec.segments - 1;
        drawRing(view.ring, anim.spec, (i) =>
          i === last ? { thick: 1 + 0.5 * bump, longer: bump } : undefined,
        );
      } else {
        // Straight on from the pop, with no easing in so there is no pause: they all go
        // together, each getting thinner (and only a little shorter) while it fades.
        const u = (t - RING_FINISH_POP_END) / (1 - RING_FINISH_POP_END);
        const e = 1 - (1 - u) ** 2;
        const n = anim.spec.segments;
        // If the ring also lost a segment on this tick, the others slide round to fill its place
        // as they fade, and the segment that is going fades out ahead of the rest.
        const losing = anim.final !== null && anim.final.segments === n - 1;
        drawRing(
          view.ring,
          anim.spec,
          (i) =>
            losing && i === n - 1
              ? { thin: 1 - 0.85 * e, short: 1 - 0.1 * e, alpha: Math.max(0, 1 - 3 * e) }
              : { thin: 1 - 0.85 * e, short: 1 - 0.1 * e, alpha: 1 - e },
          losing ? n - 1 : true,
          losing ? n - e : n,
        );
      }
    }
  }

  /** Draw the player's queued moves as arrows. */
  drawQueue(queue: readonly Order[], color: number): void {
    const g = this.queueLayer;
    g.clear();
    // The order that runs next stands out; the rest are a little darker and thinner.
    const next: ArrowStyle = { color: mix(color, 0xffffff, 0.2), width: 5.5 };
    const later: ArrowStyle = { color: mix(color, 0x141a24, 0.3), width: 4 };
    drawArrows(
      g,
      queue
        .slice(0, 300)
        .map((order, i) => ({ from: order.from, to: order.to, style: i === 0 ? next : later })),
    );
  }

  /** Draw the path being dragged out, before it is committed. */
  drawPending(path: readonly Hex[]): void {
    const g = this.pendingLayer;
    g.clear();
    const style: ArrowStyle = { color: 0xffffff, width: 4.5 };
    const arrows: Arrow[] = [];
    for (let i = 1; i < path.length; i++) arrows.push({ from: path[i - 1]!, to: path[i]!, style });
    drawArrows(g, arrows);
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

  /** Keep this many pixels at the bottom of the screen clear when fitting the board (the tutorial's guide sits there). */
  setBottomInset(pixels: number): void {
    this.bottomInset = pixels;
  }

  /** Zoom and center so the whole board is visible. */
  fitToBoard(): void {
    const bounds = this.tileLayer.getLocalBounds();
    const { width, height: fullHeight } = this.app.screen;
    const height = fullHeight - this.bottomInset;
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

interface ArrowStyle {
  readonly color: number;
  /** Thickness of the shaft in pixels. */
  readonly width: number;
}

interface Arrow {
  readonly from: Hex;
  readonly to: Hex;
  readonly style: ArrowStyle;
}

/**
 * Arrows from the middle of one hex to just short of the next, with rounded heads and a dark
 * edge so they read on any tile. All the edges go down first, then all the colored bodies, so
 * joined arrows (a path) merge into one clean shape.
 */
const smoothstep = (t: number): number => t * t * (3 - 2 * t);

const prefersReducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 0 to 1 and back: up to the peak at `peak` (0 to 1) of the way through, then down again, both eased. */
const popCurve = (t: number, peak: number): number =>
  t < peak ? 1 - (1 - t / peak) ** 2 : 1 - smoothstep((t - peak) / (1 - peak));

/** What the ring around a tile should show, or null when this tile has none (or it is not yours to see). */
function ringSpec(
  tile: Tile,
  center: Point,
  owner: number | null,
  game: GameView,
): RingSpec | null {
  // Only the owner sees a tile's generation timing.
  if (owner === null || tile.owner !== game.playerId || !game.config) return null;
  // Only cities and villages produce troops, and the cycle shortens with each owned farm around them.
  const total = generationInterval(game.config, tile.type, ownedFarmNeighbors(game.tiles, tile));
  if (total === null || total < 2) return null;
  // Very long cycles collapse into a fixed number of chunks.
  const segments = Math.min(total, MAX_RING_SEGMENTS);
  return {
    center,
    color: owner,
    segments,
    filled: Math.floor((Math.min(tile.progress, total) * segments) / total),
    paused: isGenerationPaused(game.config, tile),
  };
}

/**
 * How a fight turned out for the army that attacked: what is left of it, and how many it lost.
 * Read from the tile afterwards, which holds the winner's survivors.
 */
function battleOutcome(
  troops: number,
  defenders: number,
  after: Tile | undefined,
  player: string,
): { won: boolean; remaining: number; lost: number; defenderLost: number } {
  const won = after?.owner === player;
  const remaining = won ? Math.min(troops, after?.troops ?? 0) : 0;
  // A defender that held keeps what is left on the tile; one that was beaten lost everything.
  const defenderLost = won ? defenders : Math.max(0, defenders - (after?.troops ?? 0));
  return { won, remaining, lost: troops - remaining, defenderLost };
}

/**
 * The pop for segments that filled during a ring's slide (a farm changed hands on the tick the
 * ring also advanced): the look for each of them, for `limit` segments of the ring.
 */
function newlyFilled(
  anim: { start: number; spec: RingSpec; final: RingSpec },
  now: number,
  limit: number,
): (index: number) => SegmentLook | undefined {
  const bump = popCurve(Math.min(1, (now - anim.start) / RING_POP_MS), POP_PEAK);
  return (i) =>
    i >= anim.spec.filled && i < anim.final.filled && i < limit
      ? { thick: 1 + 0.5 * bump, longer: bump }
      : undefined;
}

/** How a segment differs from the usual while it animates. */
interface SegmentLook {
  /** Thickness multiplier. */
  thick?: number;
  /** 0 to 1: how much of `SEGMENT_GROWTH` (a share of the gap between segments) it gets longer by. */
  longer?: number;
  /** Multiplies the whole segment, length and thickness, about its own middle. */
  shrink?: number;
  /** Multiplies the thickness alone. */
  thin?: number;
  /** Multiplies the length alone. */
  short?: number;
  alpha?: number;
}

/**
 * Draw a ring from scratch. `look` can change single segments (to pop or fade them); `track` puts
 * the faint empty ring underneath, for when the segments themselves leave.
 */
function drawRing(
  g: Graphics,
  spec: RingSpec,
  look?: (index: number) => SegmentLook | undefined,
  /** Draw the faint empty ring underneath: `true` for every segment, or how many of them. */
  track: boolean | number = false,
  /** How many segments' worth of the ring each one is spaced for (the default is all of them). */
  slots = spec.segments,
): void {
  g.clear();
  const step = (Math.PI * 2) / slots;
  const gap = Math.min(0.12, step * 0.3);
  // Both ends are round, so the line is shortened by its own radius at each end: the rounded tips
  // then land where flat ends would have been. A segment grows about its own middle, by a fixed
  // length (a share of the gap between segments) however long the segment is.
  const growth = SEGMENT_GROWTH * gap;
  const arc = (i: number, look: SegmentLook, color: number, alpha: number): void => {
    const shrink = look.shrink ?? 1;
    const width = SEGMENT_WIDTH * (look.thick ?? 1) * shrink * (look.thin ?? 1);
    const middle = -Math.PI / 2 + (i + 0.5) * step;
    const length =
      ((step - gap) / 2) * shrink * (look.short ?? 1) + (growth / 2) * (look.longer ?? 0);
    const half = Math.max(0.001, length - width / 2 / RING_RADIUS);
    // Walked as a polyline: a lone arc segment can leave its start cap flat.
    const points = Math.max(2, Math.ceil((half * 2) / 0.08));
    for (let p = 0; p <= points; p++) {
      const angle = middle - half + (half * 2 * p) / points;
      const x = spec.center.x + RING_RADIUS * Math.cos(angle);
      const y = spec.center.y + RING_RADIUS * Math.sin(angle);
      if (p === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke({ width, color, alpha, cap: 'round', join: 'round' });
  };
  const trackCount = track === true ? spec.segments : track === false ? 0 : track;
  for (let i = 0; i < trackCount; i++) arc(i, {}, spec.color, 0.22);
  for (let i = 0; i < spec.segments; i++) {
    const on = i < spec.filled;
    const color = on && spec.paused ? 0xffffff : spec.color;
    const alpha = on ? (spec.paused ? 0.4 : 1) : 0.22;
    const mod = look?.(i);
    arc(i, mod ?? {}, color, mod?.alpha ?? alpha);
  }
}

function drawArrows(g: Graphics, arrows: readonly Arrow[]): void {
  const shapes = arrows.map(({ from, to, style }) => {
    const a = hexToPixel(from);
    const b = hexToPixel(to);
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const ux = (b.x - a.x) / length;
    const uy = (b.y - a.y) / length;
    const start = { x: a.x + ux * HEX_SIZE * 0.44, y: a.y + uy * HEX_SIZE * 0.44 };
    const tip = { x: b.x - ux * HEX_SIZE * 0.4, y: b.y - uy * HEX_SIZE * 0.4 };
    const headLength = 7 + style.width * 0.5;
    const headWidth = 4 + style.width * 0.55;
    const base = { x: tip.x - ux * headLength, y: tip.y - uy * headLength };
    const head = [
      tip.x,
      tip.y,
      base.x - uy * headWidth,
      base.y + ux * headWidth,
      base.x + uy * headWidth,
      base.y - ux * headWidth,
    ];
    // The shaft runs a little into the head so no gap shows where they meet.
    const shaftEnd = { x: base.x + ux * 2, y: base.y + uy * 2 };
    return { start, shaftEnd, head, style };
  });
  for (const { start, shaftEnd, head, style } of shapes) {
    const edge = { color: ARROW_OUTLINE, alpha: 0.55 };
    g.moveTo(start.x, start.y)
      .lineTo(shaftEnd.x, shaftEnd.y)
      // The head's colored stroke (2px) sits on its dark one (3.5px), leaving 0.75px of edge; the
      // shaft gets the same 0.75px each side.
      .stroke({ ...edge, width: style.width + 1.5, cap: 'round' });
    g.poly(head)
      .fill(edge)
      .stroke({ ...edge, width: 3.5, join: 'round' });
  }
  for (const { start, shaftEnd, head, style } of shapes) {
    g.moveTo(start.x, start.y)
      .lineTo(shaftEnd.x, shaftEnd.y)
      .stroke({ width: style.width, color: style.color, cap: 'round' });
    g.poly(head).fill(style.color).stroke({ width: 2, color: style.color, join: 'round' });
  }
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
  for (const dy of [11.5, 15]) {
    g.moveTo(c.x - 12, c.y + dy)
      .lineTo(c.x + 12, c.y + dy)
      .stroke({ width: 1.2, color: art.faint, cap: 'round' });
  }
  for (const [dx, bend] of stalks) drawWheat(g, c.x + dx, c.y + 6.5, bend, art.crop);
}

/**
 * One wheat plant growing up from (x, y). The stem curves in the direction of `bend`
 * (negative = left, positive = right) and the ear on top tilts further the same way.
 */
function drawWheat(g: Graphics, x: number, y: number, bend: number, color: number): void {
  const scale = 0.7;
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
  const k = 0.94;
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
