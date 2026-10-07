import { hexEquals, hexLine, type Hex, type Order } from '@hexxar/shared';

/** Anti-runaway limit on a single drag. */
const MAX_PATH_HEXES = 200;

/**
 * The path being dragged out before it is committed. Dragging onto an adjacent
 * hex extends it; dragging back onto the previous hex retracts it. If the
 * pointer jumps several hexes at once, the path follows the straight line.
 */
export class PathDraft {
  private hexes: Hex[] = [];

  get active(): boolean {
    return this.hexes.length > 0;
  }

  /** Every hex on the path, starting with where the drag began. */
  get path(): readonly Hex[] {
    return this.hexes;
  }

  begin(start: Hex): void {
    this.hexes = [start];
  }

  clear(): void {
    this.hexes = [];
  }

  /** Follow the pointer to `target`. Hexes failing `exists` (off the board) stop the path. */
  extendTo(target: Hex, exists: (hex: Hex) => boolean): void {
    const end = this.hexes.at(-1);
    if (!end || hexEquals(end, target)) return;
    for (const step of hexLine(end, target).slice(1)) {
      const previous = this.hexes.at(-2);
      if (previous && hexEquals(previous, step)) {
        this.hexes.pop();
      } else if (exists(step) && this.hexes.length < MAX_PATH_HEXES) {
        this.hexes.push(step);
      } else {
        break;
      }
    }
  }

  /** One move order per step of the path. */
  moves(): Order[] {
    const orders: Order[] = [];
    for (let i = 1; i < this.hexes.length; i++) {
      orders.push({ type: 'move', from: this.hexes[i - 1]!, to: this.hexes[i]! });
    }
    return orders;
  }
}
