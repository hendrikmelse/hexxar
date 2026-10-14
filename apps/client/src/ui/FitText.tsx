import { useLayoutEffect, useRef } from 'react';

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
  onClip,
}: {
  text: string;
  max: number;
  min: number;
  className?: string;
  /** Overrides the text color. */
  color?: string;
  /** Told after every fit whether the text is cut off with "..." at its smallest size. */
  onClip?: (clipped: boolean) => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      // Measure at full size, then scale down in half-pixel steps by how far it overflows.
      el.style.fontSize = `${max}px`;
      const available = el.clientWidth;
      const needed = el.scrollWidth;
      if (available > 0 && needed > available) {
        const scaled = Math.floor(((max * available) / needed) * 2) / 2;
        el.style.fontSize = `${Math.max(min, scaled)}px`;
      }
      onClip?.(el.scrollWidth > el.clientWidth);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, max, min]);

  return (
    <span ref={ref} className={className} style={color ? { color } : undefined}>
      {text}
    </span>
  );
}
