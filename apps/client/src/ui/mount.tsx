import { createRoot } from 'react-dom/client';
import { App, effectiveSymmetry, type Actions, type PreviewOptions } from './App.js';
import './ui.css';

export { effectiveSymmetry };
export type { Actions, PreviewOptions };

/** Render the menu, lobby and results screens into `root`. */
export function mountUi(root: HTMLElement, actions: Actions): void {
  createRoot(root).render(<App actions={actions} />);
}
