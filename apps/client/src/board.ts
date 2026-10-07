import { Application, Container, Graphics, Text } from 'pixi.js';
import { hexKey, type Hex, type Order, type Tile } from '@hexxar/shared';
import type { GameView } from './game.js';
import { HEX_SIZE, hexCorners, hexToPixel, pixelToHex, type Point } from './layout.js';

/** Distinct, flat player colors, assigned by player order. */
export const PLAYER_COLORS = [
  0x4f9dff, 0xff6b6b, 0xffd166, 0x06d6a0, 0xc77dff, 0xff9f43, 0x2ec4b6, 0xf15bb5,
];

const BACKGROUND = 0x14161c;
const NEUTRAL_FILL = { farmland: 0x252a33, village: 0x2b3140, city: 0x333a4e } as const;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;
const DRAG_THRESHOLD = 5;

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

/** Draws the hex map and handles pan, zoom and clicks. */
export class Board {
  private readonly world = new Container();
  private readonly tileLayer = new Container();
  private readonly queueLayer = new Graphics();
  private readonly selectionLayer = new Graphics();
  private readonly views = new Map<string, TileView>();
  private fitted = false;

  private constructor(
    private readonly app: Application,
    private readonly onHexClick: (hex: Hex) => void,
  ) {
    this.world.addChild(this.tileLayer, this.queueLayer, this.selectionLayer);
    app.stage.addChild(this.world);
    this.attachInput();
  }

  static async create(host: HTMLElement, onHexClick: (hex: Hex) => void): Promise<Board> {
    const app = new Application();
    await app.init({
      resizeTo: window,
      background: BACKGROUND,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });
    host.appendChild(app.canvas);
    return new Board(app, onHexClick);
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
          fontSize: 15,
          fontWeight: '600',
          fill: 0xffffff,
          fontFamily: 'system-ui, sans-serif',
        },
      });
      label.anchor.set(0.5);
      label.position.set(center.x, center.y + 4);
      view = { shape: new Graphics(), label };
      this.tileLayer.addChild(view.shape, view.label);
      this.views.set(key, view);
    }

    const center = hexToPixel(tile);
    const owner = playerColor(game, tile.owner);
    const fill = owner === null ? NEUTRAL_FILL[tile.type] : mix(BACKGROUND, owner, 0.55);
    const shape = view.shape;
    shape.clear();
    shape.poly(hexCorners(center, 1.5)).fill(fill);
    if (owner !== null) shape.poly(hexCorners(center, 1.5)).stroke({ width: 2, color: owner });

    // Tile type markers: village = dot, city = diamond, farmland = none.
    const marker = owner ?? 0x8a93a8;
    if (tile.type === 'village') {
      shape.circle(center.x, center.y - 13, 4).fill({ color: marker, alpha: 0.9 });
    } else if (tile.type === 'city') {
      const y = center.y - 13;
      shape.poly([center.x, y - 6, center.x + 6, y, center.x, y + 6, center.x - 6, y]).fill({
        color: marker,
        alpha: 0.9,
      });
    }
    view.label.text = tile.troops > 0 ? String(tile.troops) : '';
  }

  /** Draw the player's queued moves as arrows. */
  drawQueue(queue: readonly Order[], color: number): void {
    const g = this.queueLayer;
    g.clear();
    queue.slice(0, 300).forEach((order, i) => {
      const from = hexToPixel(order.from);
      const to = hexToPixel(order.to);
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.hypot(dx, dy) || 1;
      const ux = dx / length;
      const uy = dy / length;
      const alpha = i === 0 ? 1 : 0.55;
      // Run from the middle of the source hex to just short of the target's center.
      const start = { x: from.x + ux * HEX_SIZE * 0.2, y: from.y + uy * HEX_SIZE * 0.2 };
      const end = { x: to.x - ux * HEX_SIZE * 0.25, y: to.y - uy * HEX_SIZE * 0.25 };
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
    });
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
    this.world.position.set(
      width / 2 - (bounds.x + bounds.width / 2) * scale,
      height / 2 - (bounds.y + bounds.height / 2) * scale,
    );
  }

  private attachInput(): void {
    const canvas = this.app.canvas;
    let drag: { x: number; y: number; moved: boolean } | null = null;

    canvas.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, moved: false };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      drag.moved = true;
      this.world.position.x += dx;
      this.world.position.y += dy;
      drag.x = e.clientX;
      drag.y = e.clientY;
    });
    canvas.addEventListener('pointerup', (e) => {
      const wasDrag = drag?.moved ?? true;
      drag = null;
      if (wasDrag) return;
      const rect = canvas.getBoundingClientRect();
      const local = this.world.toLocal({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      this.onHexClick(pixelToHex(local as Point));
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
        // Keep the point under the cursor fixed while zooming.
        this.world.position.set(cursor.x - before.x * next, cursor.y - before.y * next);
      },
      { passive: false },
    );
  }
}
