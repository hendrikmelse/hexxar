import { createRoot } from 'react-dom/client';
import { App, type Actions, type PreviewOptions } from './App.js';
import './ui.css';

export type { Actions, PreviewOptions };

/** Render the menu, lobby and results screens into `root`. */
export function mountUi(root: HTMLElement, actions: Actions): void {
  createRoot(root).render(<App actions={actions} />);
}
