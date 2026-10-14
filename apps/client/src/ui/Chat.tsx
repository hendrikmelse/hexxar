import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CHAT_MAX_LENGTH } from '@hexxar/shared';
import { paletteColor } from '../board.js';
import { useApp } from '../store.js';
import type { Actions } from './App.js';

/** How close to the bottom the log has to be scrolled for new messages to keep it there. */
const STICK_PX = 40;
/** How far one turn of the mouse wheel scrolls the log, compared with the browser's usual. */
const WHEEL_SCALE = 0.333;
/** How long the log takes to cover most of the way to where the wheel has sent it (a time constant, in ms). */
const GLIDE_MS = 90;

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
  /** The log is gliding down to the newest message: it is still at the bottom, as far as it is concerned. */
  const following = useRef(false);
  /** Set up with the wheel's gliding: eases the log down to the end. */
  const glideToEnd = useRef<(() => void) | null>(null);
  const shownLast = useRef<number | undefined>(undefined);

  // Keep up with new messages, unless the reader has scrolled up to look at older ones.
  const last = app.chat[app.chat.length - 1]?.id;
  useEffect(() => {
    const el = log.current;
    if (!el || !stuck.current) return;
    // A new message glides the log down to it (from however far up it was scrolled); opening the
    // chat, with nothing new, just puts it at the end.
    const arrived = shownLast.current !== last;
    shownLast.current = last;
    if (arrived && glideToEnd.current) glideToEnd.current();
    else el.scrollTop = el.scrollHeight;
  }, [last, open]);
  useEffect(() => {
    if (open) setSeen(app.chat.length);
  }, [open, last]);
  // Opening it is for writing something.
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  const unread = open ? 0 : Math.max(0, app.chat.length - seen);

  // The log scrolls at a gentler pace than the browser's own, which suits so small a window, and
  // glides there: every turn of the wheel moves a target, and each frame the log eases toward it.
  // (Done by hand: the browser's own smooth scrolling starts over with every call, which is jerky
  // when the wheel is turned quickly, or back and forth.) A listener of its own, too: React's wheel
  // handlers cannot hold the page's scrolling back.
  useEffect(() => {
    const el = log.current;
    if (!el) return;
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let target = 0;
    let position = 0;
    let frame = 0;
    let before = 0;
    const furthest = (): number => el.scrollHeight - el.clientHeight;
    const glide = (now: number): void => {
      // On its way to the newest message, it goes on to wherever the end is by then.
      target = following.current
        ? Math.max(0, furthest())
        : Math.min(target, Math.max(0, furthest()));
      position += (target - position) * (1 - Math.exp(-(now - before) / GLIDE_MS));
      before = now;
      if (Math.abs(target - position) < 0.5) position = target;
      el.scrollTop = position;
      frame = position === target ? 0 : requestAnimationFrame(glide);
      if (frame === 0) following.current = false;
    };
    const toEnd = (): void => {
      if (calm) {
        el.scrollTop = el.scrollHeight;
        return;
      }
      following.current = true;
      if (frame !== 0) return;
      target = position = el.scrollTop;
      before = performance.now();
      frame = requestAnimationFrame(glide);
    };
    glideToEnd.current = toEnd;
    const onWheel = (event: WheelEvent): void => {
      if (event.ctrlKey) return;
      const unit = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? el.clientHeight : 1;
      const step = event.deltaY * unit * WHEEL_SCALE;
      // Gliding, the log is on its way to the target; otherwise, it starts from where it is.
      if (frame === 0) target = position = el.scrollTop;
      // Already at the end it is heading for: the wheel carries on to the page as usual.
      if (step === 0 || (step < 0 && target <= 0) || (step > 0 && target >= furthest())) return;
      event.preventDefault();
      // Whoever turns the wheel is in charge of where the log goes now.
      following.current = false;
      target = Math.min(furthest(), Math.max(0, target + step));
      if (calm) {
        el.scrollTop = position = target;
      } else if (frame === 0) {
        before = performance.now();
        frame = requestAnimationFrame(glide);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      cancelAnimationFrame(frame);
      glideToEnd.current = null;
    };
  }, []);

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
        <div className="chat-log">
          <div
            className="chat-scroll"
            ref={log}
            role="log"
            aria-live="polite"
            onScroll={(event) => {
              const el = event.currentTarget;
              // On its way down to the newest message, the log has not left the bottom.
              if (!following.current) {
                stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
              }
            }}
          >
            {app.chat.length === 0 && <p className="chat-empty">Nothing said yet.</p>}
            {app.chat.map((message) => (
              <p key={message.id} className={message.userId === you ? 'mine' : undefined}>
                <strong
                  style={
                    message.color === null
                      ? undefined
                      : { color: `#${paletteColor(message.color).toString(16).padStart(6, '0')}` }
                  }
                >
                  {message.name}
                  {message.userId === you && ' (you)'}
                </strong>{' '}
                {message.text}
              </p>
            ))}
          </div>
        </div>
        <form className="chat-form" onSubmit={submit}>
          {/* In the bottom left of the window; shut, it is all there is. */}
          <button
            type="button"
            className="chat-toggle"
            data-sound={open ? 'ui.back' : undefined}
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
                transform={open ? 'translate(-1.1 2.2) rotate(-45 12 12)' : undefined}
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
