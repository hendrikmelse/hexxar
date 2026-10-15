import { createRoot } from 'react-dom/client';
import { Logo } from './ui/Logo.js';
import './ui/ui.css';

/** What a phone is shown instead of the game, until the game works on phones: a menu card. */
export function showPhoneNotice(): void {
  // Only the notice: none of the game's other layers are wanted here.
  for (const id of ['hud', 'app']) document.getElementById(id)?.remove();
  createRoot(document.getElementById('ui')!).render(
    <div className="screen">
      <div className="card menu phone-notice">
        <Logo />
        <p>Sorry, there is no phone support yet.</p>
        <p>
          Please visit <strong>hexxar.io</strong> from a computer.
        </p>
      </div>
    </div>,
  );
}
