import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import qrcode from 'qrcode-generator';
import { SUPPORT_LINKS } from '../support.js';
import { ProviderLogo } from './logos.js';

/** Venmo first, then PayPal. */
const OPTIONS = [
  { id: 'venmo', name: 'Venmo', logoHeight: 18 },
  { id: 'paypal', name: 'PayPal', logoHeight: 26 },
] as const;

type OptionId = (typeof OPTIONS)[number]['id'];

/** A QR code for a link, as an SVG: one path of dark squares, with the quiet border around it. */
function QrCode({ link, label }: { link: string; label: string }) {
  const drawn = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(link);
    qr.make();
    const size = qr.getModuleCount();
    let path = '';
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        if (qr.isDark(row, col)) path += `M${col + 2} ${row + 2}h1v1h-1z`;
      }
    }
    return { size, path };
  }, [link]);
  const side = drawn.size + 4;
  return (
    <svg
      className="qr"
      viewBox={`0 0 ${side} ${side}`}
      role="img"
      aria-label={`QR code for ${label}`}
      shapeRendering="crispEdges"
    >
      <rect width={side} height={side} fill="#ffffff" />
      <path d={drawn.path} fill="#000000" />
    </svg>
  );
}

/** A small QR-code glyph for the button that shows the real one: three corner marks and some dots. */
function QrIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M3 3h7v7H3zm2 2v3h3V5zM14 3h7v7h-7zm2 2v3h3V5zM3 14h7v7H3zm2 2v3h3v-3z"
      />
      <path d="M14 14h2.5v2.5H14zM18.5 14H21v2.5h-2.5zM14 18.5h2.5V21H14zM16.5 16.5H19V19h-2.5zM19 19h2v2h-2z" />
    </svg>
  );
}

/** The mark for a link that opens in a new tab: an arrow leaving a box. */
function NewTabIcon() {
  return (
    <svg className="new-tab-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

/** The card that opens from the support link: PayPal and Venmo, each showing its QR code on a click. */
function SupportCard({ onClose }: { onClose: () => void }) {
  // One of the two codes is always showing, Venmo's to begin with.
  const [shown, setShown] = useState<OptionId>('venmo');
  const shownOption = OPTIONS.find((option) => option.id === shown) ?? OPTIONS[0];
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="support-backdrop" onClick={onClose}>
      <div
        className="card support-card"
        role="dialog"
        aria-label="Support Hexxar"
        onClick={(event) => event.stopPropagation()}
      >
        <h2>Support Hexxar</h2>
        <p className="muted center">
          Hexxar is free to play, and has no ads. If you are enjoying it, please consider chipping
          to help support costs.
        </p>
        <div className="support-options">
          {OPTIONS.map(({ id, name, logoHeight }) => {
            const link = SUPPORT_LINKS[id];
            const open = shown === id;
            return (
              <div key={id} className="support-row">
                <button
                  className="support-pay"
                  aria-label={`Give with ${name}`}
                  disabled={!link}
                  onClick={() => window.open(link, '_blank', 'noopener,noreferrer')}
                >
                  <span className="logo-chip">
                    <ProviderLogo id={id} height={logoHeight} />
                  </span>
                  <NewTabIcon />
                </button>
                <button
                  className={`support-qr-button hint ${open ? 'on' : ''}`}
                  aria-label={`Show the ${name} QR code`}
                  aria-pressed={open}
                  data-tip={open ? undefined : 'Show QR code'}
                  data-tip-pos="below-center"
                  disabled={!link}
                  onClick={() => setShown(id)}
                >
                  <QrIcon />
                </button>
              </div>
            );
          })}
        </div>
        {/* One panel for both codes, always there at the same size, so nothing moves when one is swapped for the other. */}
        <div className="support-qr">
          {SUPPORT_LINKS[shownOption.id] ? (
            <>
              <QrCode link={SUPPORT_LINKS[shownOption.id]} label={shownOption.name} />
              <span className="support-qr-caption">
                Scan to give with{' '}
                <span className="logo-chip small">
                  <ProviderLogo id={shownOption.id} height={shownOption.id === 'venmo' ? 11 : 15} />
                </span>
              </span>
            </>
          ) : (
            <span className="support-qr-empty">The {shownOption.name} link is coming soon.</span>
          )}
        </div>
        <button data-sound="ui.back" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

/** "Enjoying Hexxar? Support it.", with the card it opens. */
export function SupportLink() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <p className="support-line">
        Enjoying Hexxar?{' '}
        <button className="support-link" onClick={() => setOpen(true)}>
          Support it.
        </button>
      </p>
      {/* Out in the page's own layer, not inside whatever row the link is in. */}
      {open &&
        createPortal(
          <SupportCard onClose={() => setOpen(false)} />,
          document.getElementById('ui') ?? document.body,
        )}
    </>
  );
}
