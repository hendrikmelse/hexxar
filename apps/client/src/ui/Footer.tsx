import { navigate } from '../store.js';

/** Where the privacy policy page lives. */
export const PRIVACY_PATH = '/privacy';

/** The quiet line at the bottom of the menu pages: privacy policy, copyright, and the maker's site. */
export function Footer() {
  return (
    <nav className="site-footer" aria-label="About Hexxar">
      <a
        href={PRIVACY_PATH}
        onClick={(event) => {
          // Same tab, and without reloading: a lobby you are in stays open behind it.
          event.preventDefault();
          navigate(PRIVACY_PATH);
        }}
      >
        Privacy policy
      </a>
      <span aria-hidden="true">·</span>
      <span>&copy; {new Date().getFullYear()} Hendrik Melse</span>
      <span aria-hidden="true">·</span>
      <a href="https://hendrikmelse.com" target="_blank" rel="noopener noreferrer">
        hendrikmelse.com
      </a>
    </nav>
  );
}
