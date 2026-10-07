import type { Actions } from './App.js';

/** Temporary tools for looking at generated maps while the generator is tuned. */
export function Preview({ actions, seed }: { actions: Actions; seed: number }) {
  return (
    <div className="preview">
      <button onClick={actions.newPreview}>Generate new map</button>
      <button onClick={actions.exitPreview}>Back to menu</button>
      <span>Map preview · seed {seed}</span>
    </div>
  );
}
