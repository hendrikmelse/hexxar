import { useEffect, useState } from 'react';
import { playSound } from '../audio/audio.js';
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
function Spotlight({ target, outline }: { target: keyof typeof TARGETS; outline: boolean }) {
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
  // The arrow comes in from the side of the screen the thing is not on.
  const fromLeft = target === 'camera';
  return (
    <>
      {outline && (
        <div
          className={`spotlight ${TARGETS[target].round ? 'round' : ''}`}
          style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
        />
      )}
      <svg
        className={`spotlight-arrow ${fromLeft ? 'from-left' : ''}`}
        style={{
          left: fromLeft ? box.x - 118 : box.x + box.w + 8,
          top: box.y + box.h / 2 - 32,
        }}
        width="110"
        height="64"
        viewBox="0 0 66 40"
        aria-hidden="true"
      >
        <path
          d="M3 20 L25 3 L25 13 L63 13 L63 27 L25 27 L25 37 Z"
          fill="#ffd966"
          stroke="#3a2d10"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
      </svg>
    </>
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

  // A task being finished, a step failing, and the whole tutorial being finished.
  const taskDone = view.hasTask && canGoOn;
  useEffect(() => {
    if (taskDone) playSound('tutorial.task');
  }, [taskDone, view.lesson, view.step]);
  useEffect(() => {
    if (view.failure) playSound('tutorial.fail');
  }, [view.failure]);
  useEffect(() => {
    if (view.finished) playSound('tutorial.finished');
  }, [view.finished]);

  if (view.finished) {
    return (
      <div className="tutorial">
        <div className="tutorial-finish">
          <div className="tutorial-card finish" role="dialog" aria-label="Tutorial finished">
            <div className="tutorial-head">
              <span className="tutorial-lesson">Tutorial complete</span>
              <h3>Congratulations, you finished the tutorial!</h3>
            </div>
            <p className="tutorial-text">
              You know how to give orders, grow your production, win battles, and find your way
              through the fog. You are ready for real matches. Good luck!
            </p>
            <div className="tutorial-finish-buttons">
              <button className="primary" data-sound="ui.back" onClick={actions.exitTutorial}>
                Back to main menu
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="tutorial">
      {view.hud && <Spotlight key={view.hud} target={view.hud} outline={view.hudOutline} />}

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
        <button className="leave" data-sound="ui.back" onClick={actions.exitTutorial}>
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
          <span className="tutorial-left">
            <button
              data-sound="tutorial.next"
              onClick={actions.tutorialBack}
              disabled={view.lesson === 0 && view.step === 0}
            >
              Back
            </button>
            {view.hasTask && (
              <span className="next-wrap">
                {view.failure && (
                  <span className="next-rings" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                )}
                <button
                  className={view.failure ? 'ready' : ''}
                  onClick={actions.tutorialReset}
                  title="Start this page over"
                >
                  Reset
                </button>
              </span>
            )}
          </span>
          <span className="tutorial-status">
            {!view.failure && view.hasTask && !view.done ? 'Your turn' : ''}
          </span>
          <span className="next-wrap">
            {canGoOn && view.hasTask && (
              <span className="next-rings" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            )}
            <button
              className={`primary ${canGoOn && view.hasTask ? 'ready' : ''}`}
              disabled={!canGoOn}
              data-sound="tutorial.next"
              onClick={actions.tutorialNext}
            >
              {nextLabel}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
