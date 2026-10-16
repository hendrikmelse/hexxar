import { useLayoutEffect, useRef, type RefObject } from 'react';

const SLIDE_MS = 300;

/**
 * Where an element is laid out, in the page. Unlike `getBoundingClientRect`, this ignores
 * transforms, so a box in the middle of its "pop" (or of a slide) is measured where it belongs.
 */
function layoutPosition(node: HTMLElement): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (let el: HTMLElement | null = node; el; el = el.offsetParent as HTMLElement | null) {
    x += el.offsetLeft;
    y += el.offsetTop;
  }
  return { x, y };
}

/**
 * Makes children marked with `data-flip="<id>"` slide smoothly to their new place whenever a
 * re-render moves them, instead of jumping. (The usual "FLIP" trick: note where each one was,
 * see where it ended up, and animate the difference.) Positions are measured relative to the
 * container, so the container itself moving does not make everything slide, and they are layout
 * positions, so animations still running from the last change do not throw the measuring off.
 */
export function useFlip(container: RefObject<HTMLElement | null>): void {
  const previous = useRef(new Map<string, { x: number; y: number }>());

  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    const origin = layoutPosition(root);
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const next = new Map<string, { x: number; y: number }>();

    root.querySelectorAll<HTMLElement>('[data-flip]').forEach((node) => {
      const id = node.dataset.flip!;
      const box = layoutPosition(node);
      const at = { x: box.x - origin.x, y: box.y - origin.y };
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
