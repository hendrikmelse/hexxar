import { useEffect, useState } from 'react';
import { FEEDBACK_MAX_LENGTH, type FeedbackKind } from '@hexxar/shared';
import { serverHttpUrl } from '../serverUrl.js';
import { appStore, navigate, useApp, type AppState } from '../store.js';
import { PRIVACY_PATH } from './Footer.js';
import { Segmented } from './Lobby.js';

/** The technical details sent with every message: what they use, and where they are in the game. */
function technicalDetails(app: AppState): string {
  const lines = [
    `Page: ${location.pathname}${location.search}`,
    `Browser: ${navigator.userAgent}`,
    `Window: ${window.innerWidth}x${window.innerHeight} at ${window.devicePixelRatio}x`,
    `Language: ${navigator.language}`,
    `Connected: ${app.connected ? 'yes' : 'no'}`,
  ];
  if (app.tutorial)
    lines.push(`Tutorial: lesson ${app.tutorial.lesson + 1}, page ${app.tutorial.step + 1}`);
  if (app.room) {
    lines.push(
      `Room: ${app.room.state}, ${app.room.settings.mode} (${app.room.visibility}) ${app.room.code}`,
    );
  }
  return lines.join('\n');
}

type Status =
  { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'error'; text: string };

/**
 * The feedback and bug report page: a full page of its own, not a dialog. What is written is
 * posted to the server, which emails it on.
 */
export function Feedback() {
  const app = useApp();
  const [kind, setKind] = useState<FeedbackKind>('feedback');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const close = (): void => appStore.set({ feedbackOpen: false });
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const ready = message.trim().length >= 3 && status.kind !== 'sending';

  const send = async (): Promise<void> => {
    setStatus({ kind: 'sending' });
    try {
      const response = await fetch(serverHttpUrl('/api/feedback'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          message,
          ...(email.trim() ? { email: email.trim() } : {}),
          ...(app.name.trim() ? { name: app.name.trim().slice(0, 24) } : {}),
          details: technicalDetails(app),
          website,
        }),
      });
      if (response.ok) {
        setMessage('');
        setStatus({ kind: 'sent' });
        return;
      }
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setStatus({ kind: 'error', text: body?.error ?? 'It could not be sent. Please try again.' });
    } catch {
      setStatus({ kind: 'error', text: 'Could not reach the server. Please try again.' });
    }
  };

  return (
    <div className="screen">
      <div className="card lobby feedback-page">
        <h2>Feedback &amp; bugs</h2>

        {status.kind === 'sent' ? (
          <>
            <p className="feedback-thanks">Thank you! Your message was sent. Every one is read.</p>
            <div className="buttons">
              <button data-sound="ui.back" onClick={close}>
                Back
              </button>
              <button className="primary" onClick={() => setStatus({ kind: 'idle' })}>
                Send another
              </button>
            </div>
          </>
        ) : (
          <form
            className="feedback-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (ready) void send();
            }}
          >
            <p className="muted center">
              {"Found a bug or have an idea? I'd love to hear about it! Every message is read."}
            </p>

            <Segmented
              label="What is it about?"
              value={kind}
              options={[
                { value: 'feedback', label: 'Feedback' },
                { value: 'bug', label: 'Bug report' },
              ]}
              onChange={setKind}
            />

            <label className="field">
              <span>
                {kind === 'bug'
                  ? 'What went wrong? What did you expect to happen?'
                  : 'Your message'}
              </span>
              <textarea
                value={message}
                maxLength={FEEDBACK_MAX_LENGTH}
                rows={7}
                placeholder={
                  kind === 'bug'
                    ? 'Steps to reproduce it help most.'
                    : 'What do you like? What would you change? What new features would you like to see added?'
                }
                onChange={(event) => setMessage(event.target.value)}
              />
              <small className="feedback-count">
                {message.length} / {FEEDBACK_MAX_LENGTH}
              </small>
            </label>

            <label className="field">
              <span>Email (optional, so I can reply)</span>
              <input
                type="email"
                value={email}
                maxLength={200}
                autoComplete="email"
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>

            {/* A trap for bots: people never see it, scripts fill it in. */}
            <input
              className="feedback-trap"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
            />

            {status.kind === 'error' && (
              <p className="feedback-error" role="alert">
                {status.text}
              </p>
            )}

            {/* Said plainly, where they send it: what goes along with the message. */}
            <p className="feedback-note">
              Your message is sent with some technical details: your browser, window size and where
              you are in the game.{' '}
              <a
                href={PRIVACY_PATH}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(PRIVACY_PATH);
                }}
              >
                Privacy policy
              </a>
            </p>

            <div className="buttons">
              <button type="button" data-sound="ui.back" onClick={close}>
                Back
              </button>
              <button type="submit" className="primary" disabled={!ready}>
                {status.kind === 'sending' ? 'Sending...' : 'Send'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
