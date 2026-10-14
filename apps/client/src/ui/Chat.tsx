import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CHAT_MAX_LENGTH } from '@hexxar/shared';
import { useApp } from '../store.js';
import type { Actions } from './App.js';

/** How close to the bottom the log has to be scrolled for new messages to keep it there. */
const STICK_PX = 40;

/**
 * A small chat panel laid over the corner of the screen: the lobby's, or a spectator's during a
 * match (`match`). It can be folded away, and says how much it missed while it was.
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
  const [open, setOpen] = useState(true);
  const [text, setText] = useState('');
  const [seen, setSeen] = useState(app.chat.length);
  const log = useRef<HTMLDivElement>(null);
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
  const unread = open ? 0 : Math.max(0, app.chat.length - seen);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (text.trim() === '') return;
    actions.sendChat(text);
    setText('');
    stuck.current = true;
  };

  return (
    <div className={`chat ${match ? 'match' : 'lobby-chat'} ${open ? '' : 'folded'}`}>
      <button
        type="button"
        className="chat-head"
        data-sound="none"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span>{title}</span>
        {unread > 0 && <b className="chat-unread">{unread}</b>}
        <i aria-hidden="true">{open ? '–' : '+'}</i>
      </button>
      {open && (
        <>
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
            <input
              type="text"
              value={text}
              maxLength={CHAT_MAX_LENGTH}
              placeholder="Say something..."
              aria-label="Chat message"
              autoComplete="off"
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                // Typing must not trigger the game's shortcuts.
                event.stopPropagation();
                if (event.key === 'Escape') event.currentTarget.blur();
              }}
            />
          </form>
        </>
      )}
    </div>
  );
}
