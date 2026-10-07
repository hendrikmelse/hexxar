import { describe, expect, it } from 'vitest';
import { hexagonalBoard, hexKey } from '@hexxar/shared';
import { PathDraft } from './path.js';

const board = new Set(hexagonalBoard(3).map(hexKey));
const exists = (h: { q: number; r: number }) => board.has(hexKey(h));

describe('PathDraft', () => {
  it('extends one adjacent hex at a time', () => {
    const draft = new PathDraft();
    draft.begin({ q: 0, r: 0 });
    draft.extendTo({ q: 1, r: 0 }, exists);
    draft.extendTo({ q: 2, r: 0 }, exists);
    expect(draft.moves()).toEqual([
      { type: 'move', from: { q: 0, r: 0 }, to: { q: 1, r: 0 } },
      { type: 'move', from: { q: 1, r: 0 }, to: { q: 2, r: 0 } },
    ]);
  });

  it('fills in the hexes when the pointer jumps ahead', () => {
    const draft = new PathDraft();
    draft.begin({ q: -2, r: 0 });
    draft.extendTo({ q: 2, r: 0 }, exists);
    expect(draft.path).toHaveLength(5);
    expect(draft.moves()).toHaveLength(4);
  });

  it('retracts when the pointer goes back the way it came, including fast retraces', () => {
    const draft = new PathDraft();
    draft.begin({ q: -2, r: 0 });
    draft.extendTo({ q: 2, r: 0 }, exists);
    draft.extendTo({ q: 1, r: 0 }, exists);
    expect(draft.path.at(-1)).toEqual({ q: 1, r: 0 });
    draft.extendTo({ q: -1, r: 0 }, exists);
    expect(draft.path).toEqual([
      { q: -2, r: 0 },
      { q: -1, r: 0 },
    ]);
  });

  it('stops at the edge of the board and ignores a click without movement', () => {
    const draft = new PathDraft();
    draft.begin({ q: 2, r: 0 });
    draft.extendTo({ q: 3, r: 0 }, exists);
    draft.extendTo({ q: 5, r: 0 }, exists);
    expect(draft.path.at(-1)).toEqual({ q: 3, r: 0 });

    const still = new PathDraft();
    still.begin({ q: 0, r: 0 });
    still.extendTo({ q: 0, r: 0 }, exists);
    expect(still.moves()).toEqual([]);
  });

  it('can be cleared', () => {
    const draft = new PathDraft();
    draft.begin({ q: 0, r: 0 });
    draft.clear();
    expect(draft.active).toBe(false);
    expect(draft.moves()).toEqual([]);
  });
});
