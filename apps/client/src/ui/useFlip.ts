import { useLayoutEffect, useRef, type RefObject } from 'react';

const SLIDE_MS = 300;

/**
 * Makes children marked with `data-flip="<id>"` slide smoothly to their new place whenever a
 * re-render moves them, instead of jumping. (The usual "FLIP" trick: note where each one was,
 * see where it ended up, and animate the difference.) Positions are measured relative to the
 * container, so the container itself moving does not make everything slide.
 */
export function useFlip(container: RefObject<HTMLElement | null>): void {
  const previous = useRef(new Map<string, { x: number; y: number }>());

  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    const origin = root.getBoundingClientRect();
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const next = new Map<string, { x: number; y: number }>();

    root.querySelectorAll<HTMLElement>('[data-flip]').forEach((node) => {
      const id = node.dataset.flip!;
      const box = node.getBoundingClientRect();
      const at = { x: box.left - origin.left, y: box.top - origin.top };
      next.set(id, at);
      const before = previous.current.get(id);
      if (!before || reduceMotion) return;
      const dx = before.x - at.x;
      const dy = before.y - at.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      node.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
        { duration: SLIDE_MS, easing: 'ease-out' },
      );
    });
    previous.current = next;
  });
}
