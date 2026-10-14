import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CHAT_MAX_LENGTH } from '@hexxar/shared';
import { useApp } from '../store.js';
import type { Actions } from './App.js';

/** How close to the bottom the log has to be scrolled for new messages to keep it there. */
const STICK_PX = 40;

/**
 * The chat: a button the size of the sound and fullscreen buttons, which opens into the chat
 * window and, from the same spot, folds back. The lobby's hangs off the card; a spectator's
 * (`match`) is laid over the board. While it is shut, the button counts what it missed.
 */
export function Chat({
  actions,
  title,
  note,
  match = false,
}: {
  actions: Actions;
  title: string;
  /** Small print under the title. */
  note?: string;
  match?: boolean;
}) {
  const app = useApp();
  const you = app.room?.you;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [seen, setSeen] = useState(app.chat.length);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const stuck = useRef(true);

  // Keep up with new messages, unless the reader has scrolled up to look at older ones.
  const last = app.chat[app.chat.length - 1]?.id;
  useEffect(() => {
    const el = log.current;
    if (el && stuck.current) el.scrollTop = el.scrollHeight;
  }, [last, open]);
  useEffect(() => {
    if (open) setSeen(app.chat.length);
  }, [open, last]);
  // Opening it is for writing something.
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  const unread = open ? 0 : Math.max(0, app.chat.length - seen);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (text.trim() === '') return;
    actions.sendChat(text);
    setText('');
    stuck.current = true;
  };

  const label = open ? 'Close the chat' : 'Open the chat';
  return (
    <div className={`chat ${match ? 'match' : 'lobby-chat'} ${open ? 'open' : 'closed'}`}>
      {/* Everything stays in place while it opens and shuts, so the size can animate. */}
      <div className="chat-body">
        <h3 className="chat-head">{title}</h3>
        {note && <p className="chat-note">{note}</p>}
        <div
          className="chat-log"
          ref={log}
          role="log"
          aria-live="polite"
          onScroll={(event) => {
            const el = event.currentTarget;
            stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
          }}
        >
          {app.chat.length === 0 && <p className="chat-empty">Nothing said yet.</p>}
          {app.chat.map((message) => (
            <p key={message.id} className={message.userId === you ? 'mine' : undefined}>
              <strong>{message.name}</strong> {message.text}
            </p>
          ))}
        </div>
        <form className="chat-form" onSubmit={submit}>
          {/* In the bottom left of the window; shut, it is all there is. */}
          <button
            type="button"
            className="chat-toggle"
            data-sound="none"
            aria-expanded={open}
            aria-label={label}
            title={label}
            onClick={() => setOpen(!open)}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path
                d={
                  open
                    ? 'M12 6l-6 6 6 6M18 6l-6 6 6 6'
                    : 'M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z'
                }
                transform={open ? 'rotate(-45 12 12)' : undefined}
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          </button>
          <input
            ref={input}
            type="text"
            value={text}
            maxLength={CHAT_MAX_LENGTH}
            placeholder="Say something..."
            aria-label="Chat message"
            autoComplete="off"
            tabIndex={open ? 0 : -1}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              // Typing must not trigger the game's shortcuts.
              event.stopPropagation();
              if (event.key === 'Escape') event.currentTarget.blur();
            }}
          />
        </form>
      </div>
      {unread > 0 && <b className="chat-unread">{unread > 9 ? '9+' : unread}</b>}
    </div>
  );
}
