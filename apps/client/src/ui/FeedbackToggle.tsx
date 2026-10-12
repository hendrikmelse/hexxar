import { appStore, useApp } from '../store.js';

/**
 * The feedback button, in the top right beside the fullscreen and sound buttons: a speech bubble
 * that opens the feedback and bug report page (and closes it again).
 */
export function FeedbackToggle() {
  const open = useApp().feedbackOpen;
  const label = open ? 'Close feedback' : 'Feedback & bug reports';
  return (
    <button
      className={`sound-toggle feedback-toggle hint ${open ? 'on' : ''}`}
      aria-label={label}
      aria-pressed={open}
      data-tip={label}
      data-tip-pos="below-center"
      onClick={() => appStore.set({ feedbackOpen: !open })}
    >
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path
          d="M5 4h14a2 2 0 012 2v9a2 2 0 01-2 2h-6.5L8 21v-4H5a2 2 0 01-2-2V6a2 2 0 012-2z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    </button>
  );
}
