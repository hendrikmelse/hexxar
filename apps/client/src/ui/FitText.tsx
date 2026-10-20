import { useLayoutEffect, useRef } from 'react';
import { BotTag } from './BotTag.js';

/**
 * One line of text that shrinks, from `max` down to `min` pixels, to fit the width it is given.
 * If it still does not fit at `min`, it is cut off with "...".
 * The element needs a width limit from its parent (a flex item with `min-width: 0` will do).
 */
export function FitText({
  text,
  max,
  min,
  className,
  color,
  bot,
  onClip,
}: {
  text: string;
  max: number;
  min: number;
  className?: string;
  /** Overrides the text color. */
  color?: string;
  /** A bot's name: preceded by a grey [BOT]. */
  bot?: boolean;
  /** Told after every fit whether the text is cut off with "..." at its smallest size. */
  onClip?: (clipped: boolean) => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Whether the text is wider than its box, to a fraction of a pixel (scrollWidth and
    // clientWidth are whole numbers, so a name that is a hair too wide, and gets its "...", can
    // pass for fitting).
    const range = document.createRange();
    const overflows = (): boolean => {
      range.selectNodeContents(el);
      return range.getBoundingClientRect().width > el.getBoundingClientRect().width + 0.01;
    };
    const fit = () => {
      // Measure at full size, then scale down in half-pixel steps by how far it overflows.
      el.style.fontSize = `${max}px`;
      const available = el.clientWidth;
      const needed = el.scrollWidth;
      let size = max;
      if (available > 0 && needed > available) {
        size = Math.max(min, Math.floor(((max * available) / needed) * 2) / 2);
        el.style.fontSize = `${size}px`;
      }
      // Text does not shrink exactly in step with its size: go on down until it fits, if it can.
      while (available > 0 && size > min && overflows()) {
        size = Math.max(min, size - 0.5);
        el.style.fontSize = `${size}px`;
      }
      onClip?.(available > 0 && overflows());
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, max, min, bot]);

  return (
    <span ref={ref} className={className} style={color ? { color } : undefined}>
      {bot && (
        <>
          <BotTag />{' '}
        </>
      )}
      {text}
    </span>
  );
}
