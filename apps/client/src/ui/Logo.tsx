/** Seven extruded hexagons in a flower, and the name in stacked, extruded letters. */
const FLOWER = [
  { dx: 0, dy: 0, color: '#4f9dff' },
  { dx: 1, dy: 0, color: '#ff6b6b' },
  { dx: 0.5, dy: 0.87, color: '#ffd166' },
  { dx: -0.5, dy: 0.87, color: '#06d6a0' },
  { dx: -1, dy: 0, color: '#c77dff' },
  { dx: -0.5, dy: -0.87, color: '#ff9f43' },
  { dx: 0.5, dy: -0.87, color: '#2ec4b6' },
];

function hexPoints(cx: number, cy: number, r: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 180) * (60 * i - 30);
    return `${(cx + r * Math.cos(angle)).toFixed(2)},${(cy + r * Math.sin(angle)).toFixed(2)}`;
  }).join(' ');
}

/**
 * The logo. With a `banner`, a word is written across the top of it (the end-of-match cards use
 * "Victory!" and "Defeat"), in gold for a win and red for a loss.
 */
export function Logo({
  banner,
  tone = 'neutral',
}: {
  banner?: string;
  tone?: 'win' | 'lose' | 'neutral';
} = {}) {
  const r = 17;
  const spacing = r * Math.sqrt(3);
  const depth = 6;
  return (
    <div className={`logo ${banner ? 'with-banner' : ''}`}>
      {banner && <div className={`logo-banner ${tone}`}>{banner}</div>}
      <svg className="logo-mark" viewBox="-62 -52 124 112" aria-hidden="true">
        {/* Back rows first: each tile's side hangs down over the row behind it. */}
        {[...FLOWER]
          .sort((a, b) => a.dy - b.dy)
          .map(({ dx, dy, color }, i) => {
            const cx = dx * spacing;
            const cy = dy * spacing;
            return (
              <g key={i} className="logo-hex" style={{ animationDelay: `${i * 0.35}s` }}>
                {/* The side of the tile: the same hexagon, stacked downward and darkened. */}
                {Array.from({ length: depth }, (_, layer) => (
                  <polygon
                    key={layer}
                    points={hexPoints(cx, cy + depth - layer, r - 0.5)}
                    fill={color}
                    style={{ filter: 'brightness(0.55)' }}
                  />
                ))}
                <polygon points={hexPoints(cx, cy, r - 0.5)} fill={color} />
                <polygon points={hexPoints(cx, cy, r - 5)} fill="rgba(255,255,255,0.18)" />
              </g>
            );
          })}
      </svg>
      {/* The cards with a banner say who won or lost instead of the name of the game. */}
      {!banner && <h1>HEXXAR</h1>}
    </div>
  );
}
