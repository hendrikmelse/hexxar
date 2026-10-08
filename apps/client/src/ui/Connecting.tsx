import { Logo } from './Logo.js';

/** Shown while the connection to the server is being made, or remade. */
export function Connecting({ reconnecting }: { reconnecting: boolean }) {
  return (
    <div className="screen">
      <div className="connecting">
        <Logo />
        <p className="connecting-text" role="status">
          {reconnecting ? 'Reconnecting' : 'Connecting'}
          <span className="dots" aria-hidden="true">
            <i>.</i>
            <i>.</i>
            <i>.</i>
          </span>
        </p>
      </div>
    </div>
  );
}
