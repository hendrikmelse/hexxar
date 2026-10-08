import { Container, Sprite, Texture } from 'pixi.js';
import type { Point } from './layout.js';

/** What a tile is covered with. `away` points from the tile's middle toward the side to cover. */
export type Cover = { kind: 'hidden' } | { kind: 'far'; away: Point };

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
  private readonly layer: Container;
  private readonly texture: Texture;
  private readonly banks = new Map<string, Bank>();
  private readonly leaving = new Set<Bank>();
  private time = 0;

  constructor(layer: Container) {
    this.layer = layer;
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
      ? 'hidden'
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
      this.layer.addChild(shade, body);
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
      // A thick bank over the whole tile, spilling a little past its edges so neighbors join up.
      add(center.x, center.y, 0.62 + noise(q, r, 1) * 0.12, 0);
      for (let i = 0; i < 5; i++) {
        const angle = (Math.PI * 2 * i) / 5 + noise(q, r, 2) * 1.5;
        const reach = 13 + noise(q, r, i + 3) * 5;
        add(
          center.x + Math.cos(angle) * reach,
          center.y + Math.sin(angle) * reach,
          0.5 + noise(q, r, i + 30) * 0.16,
          i + 1,
        );
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
    // A fading bank also swells a little, as if it were blowing away.
    const swell = 1 + (1 - bank.alpha) * 0.35;
    for (const puff of bank.puffs) {
      const x = puff.x + Math.sin(this.time * puff.speed + puff.phase) * puff.drift;
      const y = puff.y + Math.cos(this.time * puff.speed * 0.8 + puff.phase) * puff.drift * 0.6;
      const scale = puff.scale * swell;
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
