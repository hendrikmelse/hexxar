import { useEffect, useState } from 'react';
import type { TutorialView } from '../tutorial/runner.js';
import type { Actions } from './App.js';

/** Where on the screen each thing a lesson can point at is. */
const TARGETS = {
  timer: { selector: '#hud .tick-badge', padding: 8, round: true },
  pie: { selector: '#hud .pie', padding: 14, round: true },
  list: { selector: '#hud .players', padding: 4, round: false },
  camera: { selector: '#hud .camera', padding: 6, round: false },
} as const;

/** Text with **bold** parts. */
function Formatted({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/(\*\*[^*]+\*\*)/)
        .map((part, index) =>
          part.startsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : part,
        )}
    </>
  );
}

/** A pulsing outline around a part of the screen, following it if it moves. */
function Spotlight({ target }: { target: keyof typeof TARGETS }) {
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  useEffect(() => {
    const { selector, padding } = TARGETS[target];
    let frame = 0;
    const follow = (): void => {
      const element = document.querySelector(selector);
      if (element) {
        const rect = element.getBoundingClientRect();
        setBox((old) => {
          const next = {
            x: Math.round(rect.left - padding),
            y: Math.round(rect.top - padding),
            w: Math.round(rect.width + padding * 2),
            h: Math.round(rect.height + padding * 2),
          };
          return old && old.x === next.x && old.y === next.y && old.w === next.w && old.h === next.h
            ? old
            : next;
        });
      }
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [target]);
  if (!box) return null;
  return (
    <div
      className={`spotlight ${TARGETS[target].round ? 'round' : ''}`}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
    />
  );
}

/**
 * The tutorial's guide: a card with what to do, over the match (which is a local one with scripted
 * rivals), plus a menu to jump between lessons and leave.
 */
export function Tutorial({ actions, view }: { actions: Actions; view: TutorialView }) {
  const [lessonsOpen, setLessonsOpen] = useState(false);
  const canGoOn = view.done && view.failure === null;
  const lastStep = view.step === view.steps - 1;
  const nextLabel = view.last ? 'Finish' : lastStep ? 'Next lesson' : 'Next';

  return (
    <div className="tutorial">
      {view.hud && <Spotlight key={view.hud} target={view.hud} />}

      <div className="tutorial-top">
        <div className="lessons">
          <button onClick={() => setLessonsOpen((open) => !open)} aria-expanded={lessonsOpen}>
            Lessons
          </button>
          {lessonsOpen && (
            <ol className="lesson-list">
              {view.lessons.map((title, index) => (
                <li key={title}>
                  <button
                    className={index === view.lesson ? 'current' : ''}
                    onClick={() => {
                      setLessonsOpen(false);
                      actions.tutorialJump(index);
                    }}
                  >
                    <span className="lesson-number">{index + 1}</span>
                    {title}
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
        <button className="leave" onClick={actions.exitTutorial}>
          Exit tutorial
        </button>
      </div>

      <div
        className={`tutorial-card ${canGoOn && view.hasTask ? 'done' : ''} ${view.failure ? 'failed' : ''}`}
        role="dialog"
        aria-label={`Tutorial: ${view.title}`}
      >
        <div className="tutorial-head">
          <span className="tutorial-lesson">
            Lesson {view.lesson + 1} of {view.lessons.length}
          </span>
          <h3>{view.title}</h3>
          <span className="tutorial-dots" aria-hidden="true">
            {Array.from({ length: view.steps }, (_, index) => (
              <i
                key={index}
                className={index < view.step ? 'past' : index === view.step ? 'now' : ''}
              />
            ))}
          </span>
        </div>

        {/* Keyed by the step, so each new step's text slides in. */}
        <p key={`${view.lesson}-${view.step}`} className="tutorial-text">
          <Formatted text={view.text} />
        </p>

        {view.failure && (
          <p className="tutorial-failure" role="status">
            {view.failure}
          </p>
        )}

        <div className="tutorial-buttons">
          <button onClick={actions.tutorialBack} disabled={view.lesson === 0 && view.step === 0}>
            Back
          </button>
          <span className="tutorial-status">
            {view.failure
              ? 'Trying again...'
              : view.hasTask
                ? view.done
                  ? 'Done!'
                  : 'Your turn'
                : ''}
          </span>
          <button
            className={`primary ${canGoOn && view.hasTask ? 'ready' : ''}`}
            disabled={!canGoOn}
            onClick={actions.tutorialNext}
          >
            {nextLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
