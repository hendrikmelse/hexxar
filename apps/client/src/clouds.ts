import { Container, Sprite, Texture } from 'pixi.js';
import type { Point } from './layout.js';

/** What a tile is covered with. `away` points from the tile's middle toward the side to cover. */
export type Cover =
  | {
      kind: 'hidden';
      /** For each neighbor this tile's cloud merges with: the way from this tile to that one. */
      joins: readonly Point[];
      /** Set when this tile is the heart of a big cloud: the way toward the middle of its hidden neighbors. */
      swell: Point | null;
    }
  | { kind: 'far'; away: Point };

/**
 * Do the clouds over two adjacent hidden tiles merge into one bigger cloud? Settled by the pair of
 * tiles alone, so the two agree and the answer never changes.
 */
export function cloudsMerge(a: { q: number; r: number }, b: { q: number; r: number }): boolean {
  const first = a.q < b.q || (a.q === b.q && a.r < b.r) ? a : b;
  const second = first === a ? b : a;
  return noise(first.q * 7 + second.q, first.r * 5 + second.r, 61) < MERGE_CHANCE;
}

/** Is this tile the heart of an even bigger cloud? Only a tile with hidden ground all round it. */
export function isBigCloud(tile: { q: number; r: number }, hiddenNeighbors: number): boolean {
  return hiddenNeighbors === 6 && noise(tile.q, tile.r, 99) < BIG_CHANCE;
}

/** Whether this tile is the one that draws the cloud joining it to this neighbor (one of the two does). */
export function drawsMerge(a: { q: number; r: number }, b: { q: number; r: number }): boolean {
  return a.q < b.q || (a.q === b.q && a.r < b.r);
}

/** One soft blob of cloud, drifting a little around where it belongs. */
interface Puff {
  readonly body: Sprite;
  readonly shade: Sprite;
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly phase: number;
  readonly speed: number;
  readonly drift: number;
}

/** The clouds over one tile. */
interface Bank {
  readonly puffs: Puff[];
  readonly signature: string;
  /** 0 is gone, 1 is fully there; it eases toward `target`. */
  alpha: number;
  target: number;
}

/** Texture size, in pixels. */
const TEXTURE = 128;
/** How fast clouds fade in and out, per second. */
const FADE_PER_SECOND = 2.6;
/** How often two neighboring hidden tiles share one bigger cloud. */
const MERGE_CHANCE = 0.5;
/** How often a tile with mostly hidden neighbors is the heart of an even bigger cloud. */
const BIG_CHANCE = 0.25;
const CLOUD_COLOR = 0xe7eef8;
const SHADE_COLOR = 0x8a9bb6;

/** A small, repeatable pseudo-random number from a tile's position, so its clouds do not jump around. */
function noise(a: number, b: number, c: number): number {
  const x = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * The fog: clouds drifting over the tiles the player cannot see. Tiles hidden entirely get a bank
 * of cloud; tiles seen from far away get a bank that leaves the edge nearest the player clear, so
 * their owner and type still show. Clouds fade in and out as vision changes.
 */
export class Clouds {
  /** The small clouds on half-covered tiles, always under the big ones on hidden tiles. */
  private readonly farLayer = new Container();
  private readonly hiddenLayer = new Container();
  private readonly texture: Texture;
  private readonly banks = new Map<string, Bank>();
  private readonly leaving = new Set<Bank>();
  private time = 0;

  constructor(layer: Container) {
    layer.addChild(this.farLayer, this.hiddenLayer);
    // A soft puff: a radial gradient, solid in the middle and fading smoothly to nothing.
    const canvas = document.createElement('canvas');
    canvas.width = TEXTURE;
    canvas.height = TEXTURE;
    const context = canvas.getContext('2d');
    if (context) {
      const mid = TEXTURE / 2;
      const gradient = context.createRadialGradient(mid, mid, 0, mid, mid, mid);
      gradient.addColorStop(0, 'rgba(255,255,255,1)');
      gradient.addColorStop(0.45, 'rgba(255,255,255,0.92)');
      gradient.addColorStop(0.75, 'rgba(255,255,255,0.4)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      context.fillStyle = gradient;
      context.fillRect(0, 0, TEXTURE, TEXTURE);
    }
    this.texture = Texture.from(canvas);
  }

  /** Cover a tile with cloud, or (with `null`) clear the cloud away. `instant` skips the fade-in. */
  cover(
    key: string,
    q: number,
    r: number,
    center: Point,
    cover: Cover | null,
    instant = false,
  ): void {
    const existing = this.banks.get(key);
    const signature = cover ? this.signatureOf(cover) : '';
    if (existing && existing.signature === signature) return;
    if (existing) {
      existing.target = 0;
      this.leaving.add(existing);
      this.banks.delete(key);
    }
    if (!cover) return;
    const bank = this.build(q, r, center, cover, signature);
    // Clouds there from the start (a new match) do not need to roll in; others fade in.
    bank.alpha = instant ? 1 : 0;
    this.banks.set(key, bank);
  }

  /** Start over: no cloud anywhere, and none leaving. */
  clear(): void {
    for (const bank of [...this.banks.values(), ...this.leaving]) this.destroy(bank);
    this.banks.clear();
    this.leaving.clear();
  }

  /** Move the clouds along, and fade them. */
  update(seconds: number): void {
    this.time += seconds;
    const step = FADE_PER_SECOND * seconds;
    for (const bank of this.banks.values()) this.animate(bank, step);
    for (const bank of this.leaving) {
      this.animate(bank, step);
      if (bank.alpha <= 0.01) {
        this.destroy(bank);
        this.leaving.delete(bank);
      }
    }
  }

  private signatureOf(cover: Cover): string {
    return cover.kind === 'hidden'
      ? `hidden:${cover.joins.map((j) => `${j.x.toFixed(1)},${j.y.toFixed(1)}`).join(';')}:${cover.swell ? `${cover.swell.x.toFixed(1)},${cover.swell.y.toFixed(1)}` : ''}`
      : `far:${cover.away.x.toFixed(2)},${cover.away.y.toFixed(2)}`;
  }

  private build(q: number, r: number, center: Point, cover: Cover, signature: string): Bank {
    const puffs: Puff[] = [];
    const add = (x: number, y: number, scale: number, n: number): void => {
      const body = new Sprite(this.texture);
      const shade = new Sprite(this.texture);
      for (const sprite of [body, shade]) {
        sprite.anchor.set(0.5);
        sprite.alpha = 0;
      }
      body.tint = CLOUD_COLOR;
      shade.tint = SHADE_COLOR;
      // The shade goes under every body, so the clouds look rounded rather than flat.
      (cover.kind === 'hidden' ? this.hiddenLayer : this.farLayer).addChild(shade, body);
      puffs.push({
        body,
        shade,
        x,
        y,
        scale,
        phase: noise(q, r, n + 9) * Math.PI * 2,
        speed: 0.35 + noise(q, r, n + 17) * 0.4,
        drift: 1.6 + noise(q, r, n + 23) * 1.8,
      });
    };

    if (cover.kind === 'hidden') {
      // A cloud over the whole tile: a large puff with a couple of big ones beside it, spilling
      // a little past the edges so neighbors join up. Fewer, bigger puffs than before.
      add(center.x, center.y, 0.8 + noise(q, r, 1) * 0.14, 0);
      for (let i = 0; i < 2; i++) {
        const angle = Math.PI * i + noise(q, r, 2) * Math.PI * 2;
        const reach = 13 + noise(q, r, i + 3) * 6;
        add(
          center.x + Math.cos(angle) * reach,
          center.y + Math.sin(angle) * reach,
          0.58 + noise(q, r, i + 30) * 0.16,
          i + 1,
        );
      }
      // Where this tile's cloud runs into a neighbor's, one big cloud spans the two: a large puff
      // across the join with a couple more along it, so it reads as one cloud, not two.
      cover.joins.forEach((way, j) => {
        const along = (t: number): Point => ({
          x: center.x + way.x * t,
          y: center.y + way.y * t,
        });
        const middle = along(0.5);
        add(middle.x, middle.y, 1.02 + noise(q, r, j + 70) * 0.14, 10 + j * 3);
        const a = along(0.25);
        const b = along(0.75);
        add(a.x, a.y - 4, 0.86 + noise(q, r, j + 80) * 0.1, 11 + j * 3);
        add(b.x, b.y - 4, 0.86 + noise(q, r, j + 90) * 0.1, 12 + j * 3);
      });
      // The heart of an even bigger cloud: a very large puff over the tile, leaning toward the
      // hidden ground around it, with big ones round it.
      if (cover.swell) {
        const lean = { x: center.x + cover.swell.x * 0.35, y: center.y + cover.swell.y * 0.35 };
        add(lean.x, lean.y - 4, 1.2 + noise(q, r, 101) * 0.15, 20);
        for (let i = 0; i < 4; i++) {
          const angle = (Math.PI * 2 * i) / 4 + noise(q, r, 102) * 1.5;
          const reach = 22 + noise(q, r, i + 103) * 8;
          add(
            lean.x + Math.cos(angle) * reach,
            lean.y + Math.sin(angle) * reach - 4,
            0.85 + noise(q, r, i + 110) * 0.15,
            21 + i,
          );
        }
      }
    } else {
      // Pushed to the far side of the tile, leaving the edge nearest the player in view.
      const cx = center.x + cover.away.x * 11;
      const cy = center.y + cover.away.y * 11;
      add(cx, cy, 0.32 + noise(q, r, 1) * 0.05, 0);
      for (let i = 0; i < 5; i++) {
        const angle = (Math.PI * 2 * i) / 5 + noise(q, r, 2) * 1.5;
        const reach = 6 + noise(q, r, i + 3) * 3;
        add(
          cx + Math.cos(angle) * reach,
          cy + Math.sin(angle) * reach,
          0.27 + noise(q, r, i + 30) * 0.07,
          i + 1,
        );
      }
    }
    return { puffs, signature, alpha: 1, target: 1 };
  }

  private animate(bank: Bank, step: number): void {
    bank.alpha += Math.max(-step, Math.min(step, bank.target - bank.alpha));
    for (const puff of bank.puffs) {
      const x = puff.x + Math.sin(this.time * puff.speed + puff.phase) * puff.drift;
      const y = puff.y + Math.cos(this.time * puff.speed * 0.8 + puff.phase) * puff.drift * 0.6;
      const scale = puff.scale;
      puff.body.position.set(x, y);
      puff.shade.position.set(x, y + 3);
      puff.body.scale.set(scale);
      puff.shade.scale.set(scale * 1.04);
      puff.body.alpha = bank.alpha * 0.96;
      puff.shade.alpha = bank.alpha * 0.3;
    }
  }

  private destroy(bank: Bank): void {
    for (const puff of bank.puffs) {
      puff.body.destroy();
      puff.shade.destroy();
    }
  }
}
