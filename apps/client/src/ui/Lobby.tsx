import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { type MapSize, type RoomMode, type RoomPlayer, type RoomView } from '@hexxar/shared';
import { useApp } from '../store.js';
import type { Actions } from './App.js';
import { FitText } from './FitText.js';
import { useFlip } from './useFlip.js';

const MIN_STARTING_TROOPS = 5;
const MAX_STARTING_TROOPS = 50;
const MIN_TICK_SECONDS = 0.1;
const MAX_TICK_SECONDS = 5;

const MAP_SIZE_LABELS: Record<MapSize, string> = {
  small: 'Small',
  normal: 'Normal',
  large: 'Large',
};
const MODE_LABELS: Record<RoomMode, string> = { duel: 'Duel', ffa: 'Battle Royale' };

/** The room before the match: who is here, the settings, and the start countdown. */
export function Lobby({ actions }: { actions: Actions }) {
  const app = useApp();
  const room = app.room as RoomView;
  const isHost = room.host === room.you;
  const isPrivate = room.visibility === 'private';
  const editable = isHost && isPrivate && room.state === 'lobby';
  const { mode, size } = room.settings;
  const players = room.players.length;
  const canStart = players >= room.minPlayers;
  const waitSeconds = useCountdown(room.earlyStartAt, app.clockOffset);
  const bump = useCountBump(players);
  const shown = useExitingList(room.players);
  const canVote = mode === 'ffa' && !isPrivate;
  const lockedIn = canVote && room.votesNeeded > 0 && room.startVotes >= room.votesNeeded;

  return (
    <div className="screen">
      <div className="card lobby">
        <h2>{isPrivate ? 'Private game' : mode === 'ffa' ? 'Battle Royale' : 'Duel'}</h2>

        {isPrivate && <InviteCode code={room.code} />}

        {mode === 'ffa' ? (
          isPrivate ? null : (
            // Quick play fills up with strangers, so a head count says more than a list of names.
            <div className="head-count">
              <strong>
                {/* Bounces each time the count changes after the lobby is on screen. */}
                <span
                  key={bump.changes}
                  className={bump.changes === 0 ? '' : bump.grew ? 'count-bump' : 'count-shrink'}
                >
                  {players}
                </span>
                <small> / {size}</small>
              </strong>
              <span>players in the lobby</span>
            </div>
          )
        ) : (
          <>
            <Versus room={room} shown={shown} />
            {!isPrivate && (
              <p className="muted center">
                {players < size ? 'Waiting for an opponent...' : 'Opponent found'}
              </p>
            )}
          </>
        )}

        {/* In a private game you know who you are playing with: twelve boxes that fill as people join. */}
        {mode === 'ffa' && isPrivate && <Roster room={room} shown={shown} />}

        {isPrivate && <Settings room={room} editable={editable} onChange={actions.updateRoom} />}

        {/* The timer and the vote are always on screen, so nothing jumps when the third player joins. */}
        {canVote && (
          <div
            className={`wait-timer ${lockedIn ? 'locked' : ''} ${waitSeconds === null ? 'paused' : ''}`}
          >
            <span className="wait-label">
              {lockedIn ? 'Enough votes: starting in' : 'Match starts in'}
            </span>
            <strong>{formatClock(waitSeconds ?? Math.round(room.waitMs / 1000))}</strong>
          </div>
        )}

        {canVote && (
          <div className="vote">
            {canStart ? (
              <button
                className={room.youVoted ? 'voted' : ''}
                disabled={lockedIn && room.youVoted}
                onClick={() => actions.voteStart(!room.youVoted)}
              >
                {`${room.youVoted ? 'Voted to start early ✓' : 'Vote to start early'} (${room.startVotes}/${room.votesNeeded})`}
              </button>
            ) : (
              <p className="vote-note">At least three players required to start</p>
            )}
          </div>
        )}

        <div className="buttons">
          {isHost && isPrivate && room.state === 'lobby' && (
            <Tip
              text={
                canStart
                  ? undefined
                  : mode === 'ffa'
                    ? 'At least three players are required to start a Battle Royale'
                    : 'Two players are required to start a duel'
              }
            >
              <button className="primary" disabled={!canStart} onClick={actions.startGame}>
                Start game
              </button>
            </Tip>
          )}
          <button onClick={actions.leaveRoom}>Leave</button>
        </div>
      </div>
    </div>
  );
}

/** How long a tooltip opened by a tap stays up. */
const TIP_TAP_MS = 2000;

/**
 * Wraps something (a button that may be disabled) with a tooltip in the app's own style. It shows
 * the moment a mouse pointer is over it, or for two seconds after a tap. No text, no tooltip.
 */
function Tip({ text, children }: { text: string | undefined; children: ReactNode }) {
  const [tapped, setTapped] = useState(false);
  useEffect(() => {
    if (!tapped) return;
    const id = setTimeout(() => setTapped(false), TIP_TAP_MS);
    return () => clearTimeout(id);
  }, [tapped]);
  return (
    <span
      className={`tip ${tapped ? 'tapped' : ''}`}
      data-tip={text}
      onClick={() => text && setTapped(true)}
    >
      {children}
    </span>
  );
}

/** How long a player's box takes to pop out of existence after they leave. */
const EXIT_MS = 400;

interface ShownPlayer {
  player: RoomPlayer;
  /** Has just left; kept on screen only for the exit animation. */
  leaving: boolean;
  /** Joined while the lobby was open (so their box pops in). */
  arrived: boolean;
}

/**
 * The players to draw: the room's players, plus anyone who has just left, kept for a moment so
 * they can be animated out. People who were there when the lobby opened do not pop in.
 */
function useExitingList(players: RoomPlayer[]): ShownPlayer[] {
  const [shown, setShown] = useState<ShownPlayer[]>(() =>
    players.map((player) => ({ player, leaving: false, arrived: false })),
  );

  useEffect(() => {
    setShown((previous) => {
      const current = new Map(players.map((p) => [p.userId, p]));
      const next = previous.map((entry) => {
        const still = current.get(entry.player.userId);
        return still ? { ...entry, player: still, leaving: false } : { ...entry, leaving: true };
      });
      for (const player of players) {
        if (!previous.some((entry) => entry.player.userId === player.userId)) {
          next.push({ player, leaving: false, arrived: true });
        }
      }
      return next;
    });
  }, [players]);

  // Once the exit animation has played, forget the people who left.
  useEffect(() => {
    if (!shown.some((entry) => entry.leaving)) return;
    const id = setTimeout(() => setShown((all) => all.filter((entry) => !entry.leaving)), EXIT_MS);
    return () => clearTimeout(id);
  }, [shown]);

  return shown;
}

/** False during the first render, true afterwards: only things that appear later animate in. */
function useArmed(): { current: boolean } {
  const armed = useRef(false);
  useEffect(() => {
    armed.current = true;
  }, []);
  return armed;
}

/**
 * An empty box. If it appears after the lobby is open (someone left), it fades in; the decision
 * is made once, when it first appears, so already-empty boxes never replay the animation.
 */
function EmptyBox({
  base,
  armed,
  children,
}: {
  base: string;
  armed: { current: boolean };
  children?: ReactNode;
}) {
  const [fadeIn] = useState(armed.current);
  return <div className={`${base} open ${fadeIn ? 'appear' : ''}`}>{children}</div>;
}

const boxClass = (entry: ShownPlayer, connected: boolean): string =>
  `${entry.leaving ? 'leaving' : entry.arrived ? 'pop' : ''} ${connected ? '' : 'away'}`;

/** The pulsing dots shown in a place that has to be filled before the game can start. */
function SearchingDots() {
  return (
    <span className="searching">
      <i />
      <i />
      <i />
    </span>
  );
}

/** A grid of boxes, one per place in the game, filled in as players join and emptied as they leave. */
function Roster({ room, shown }: { room: RoomView; shown: ShownPlayer[] }) {
  const grid = useRef<HTMLDivElement>(null);
  useFlip(grid);
  const armed = useArmed();
  return (
    <div className="roster" ref={grid}>
      {Array.from({ length: room.settings.size }, (_, index) => {
        const entry = shown[index];
        if (!entry) {
          // An empty box that shows up after the lobby is open (someone left) fades in.
          // The places that must be filled before the game can start wait with the same dots a
          // duel shows for its missing opponent; the rest are just empty.
          const needed = index < room.minPlayers;
          return (
            <EmptyBox
              key={`open-${index}`}
              base={`roster-slot${needed ? ' waiting' : ''}`}
              armed={armed}
            >
              {needed && <SearchingDots />}
            </EmptyBox>
          );
        }
        return (
          <div
            key={entry.player.userId}
            data-flip={entry.player.userId}
            className={`roster-slot ${boxClass(entry, entry.player.connected)}`}
          >
            <FitText className="name" text={entry.player.name} max={14} min={10} />
            {!entry.player.connected && <em>disconnected</em>}
          </div>
        );
      })}
    </div>
  );
}

/** The two sides of a duel: you, and your opponent or a placeholder while one is found. */
function Versus({ room, shown }: { room: RoomView; shown: ShownPlayer[] }) {
  const armed = useArmed();
  const you = shown.find((entry) => entry.player.userId === room.you);
  const opponent = shown.find((entry) => entry.player.userId !== room.you);
  return (
    // In a private game the panels match the roster's height, so switching mode moves nothing.
    <div className={`versus ${room.visibility === 'private' ? 'roster-height' : ''}`}>
      <div className="slot you">
        <FitText className="name" text={you?.player.name ?? ''} max={15} min={11} />
      </div>
      <div className="vs">VS</div>
      {opponent ? (
        <div
          key={opponent.player.userId}
          className={`slot ${boxClass(opponent, opponent.player.connected)}`}
        >
          <FitText className="name" text={opponent.player.name} max={15} min={11} />
          {!opponent.player.connected && <em>disconnected</em>}
        </div>
      ) : (
        <EmptyBox base="slot" armed={armed}>
          <SearchingDots />
        </EmptyBox>
      )}
    </div>
  );
}

function InviteCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const link = `${location.origin}/?join=${code}`;
  const copy = () => {
    void navigator.clipboard?.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="invite">
      <div>
        <span className="label">Game code</span>
        <strong className="code">{code}</strong>
      </div>
      {/* Both labels share the one spot, so the button stays as wide as the longer one. */}
      <button className="copy-button" onClick={copy}>
        <span className={copied ? 'hidden' : ''}>Copy invite link</span>
        <span className={copied ? '' : 'hidden'}>Copied!</span>
      </button>
    </div>
  );
}

/** The host gets controls; everyone else just reads what the game will be. */
function Settings({
  room,
  editable,
  onChange,
}: {
  room: RoomView;
  editable: boolean;
  onChange: Actions['updateRoom'];
}) {
  const { mode, mapSize, config } = room.settings;

  if (!editable) {
    return (
      <dl className="game-info">
        <dt>Game mode</dt>
        <dd>{MODE_LABELS[mode]}</dd>
        <dt>Map size</dt>
        <dd>{MAP_SIZE_LABELS[mapSize]}</dd>
        <dt>Tick length</dt>
        <dd>{(config.tickMs / 1000).toFixed(1)}s</dd>
        <dt>Starting troops</dt>
        <dd>{config.startingTroops}</dd>
      </dl>
    );
  }

  return (
    <div className="settings">
      <Segmented
        label="Game mode"
        value={mode}
        options={[
          { value: 'duel', label: 'Duel' },
          { value: 'ffa', label: 'Battle Royale' },
        ]}
        onChange={(value) => onChange({ mode: value })}
      />
      <Segmented
        label="Map size"
        value={mapSize}
        options={(Object.keys(MAP_SIZE_LABELS) as MapSize[]).map((value) => ({
          value,
          label: MAP_SIZE_LABELS[value],
        }))}
        onChange={(value) => onChange({ mapSize: value })}
      />
      <Slider
        label="Tick length"
        value={config.tickMs / 1000}
        min={MIN_TICK_SECONDS}
        max={MAX_TICK_SECONDS}
        limits={{ min: 0.1, max: 60 }}
        step={0.1}
        decimals={1}
        unit="s"
        onCommit={(seconds) => onChange({ config: { tickMs: Math.round(seconds * 1000) } })}
      />
      <Slider
        label="Starting troops"
        value={config.startingTroops}
        min={MIN_STARTING_TROOPS}
        max={MAX_STARTING_TROOPS}
        limits={{ min: 1, max: 1000 }}
        step={1}
        decimals={0}
        onCommit={(startingTroops) => onChange({ config: { startingTroops } })}
      />
    </div>
  );
}

/** A bar of options, one of which is selected; click another to switch. */
function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const selected = options.findIndex((option) => option.value === value);
  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = options[(selected + step + options.length) % options.length];
    if (next) onChange(next.value);
  };
  return (
    <div className="field stack">
      <span>{label}</span>
      <div
        className="segmented"
        role="radiogroup"
        aria-label={label}
        onKeyDown={onKeyDown}
        style={{ '--count': options.length, '--index': Math.max(0, selected) } as CSSProperties}
      >
        {/* The blue box behind the selected option; it slides when the selection changes. */}
        <span className="segment-indicator" aria-hidden="true" />
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            tabIndex={option.value === value ? 0 : -1}
            className={`segment ${option.value === value ? 'selected' : ''}`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** How long to wait after the last slider movement before telling the server. */
const SLIDER_SEND_DELAY_MS = 150;

/**
 * A labeled slider with a box beside it showing the value, which can also be typed into. The
 * slider covers the usual range; the box accepts anything within `limits`. Changes show at once
 * and reach the server once they settle.
 */
function Slider({
  label,
  value,
  min,
  max,
  limits,
  step,
  decimals,
  unit,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  /** The most the number box accepts (the slider only spans `min` to `max`). */
  limits: { min: number; max: number };
  step: number;
  decimals: number;
  unit?: string;
  onCommit: (value: number) => void;
}) {
  const [shown, setShown] = useState(value);
  const [draft, setDraft] = useState(value.toFixed(decimals));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  // Follow the server's value, unless it is just the one we are in the middle of sending.
  useEffect(() => {
    if (shown !== value) {
      setShown(value);
      setDraft(value.toFixed(decimals));
    }
  }, [value]);

  /** Round to the step, so values like 0.30000000000000004 never go anywhere. */
  const clean = (n: number): number => Number((Math.round(n / step) * step).toFixed(6));

  const change = (next: number) => {
    setShown(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onCommit(next), SLIDER_SEND_DELAY_MS);
  };

  const position = Math.min(max, Math.max(min, shown));
  const fill = ((position - min) / (max - min)) * 100;
  return (
    <div className="field stack">
      <span>{label}</span>
      <div className="slider-row">
        <input
          type="range"
          className="slider"
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={position}
          style={{ '--fill': `${fill}%` } as CSSProperties}
          onChange={(e) => {
            const next = clean(Number(e.target.value));
            setDraft(next.toFixed(decimals));
            change(next);
          }}
        />
        <span className="value-box">
          <input
            type="text"
            inputMode="decimal"
            className="slider-value"
            aria-label={`${label}, exact value`}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              const typed = Number(e.target.value);
              if (e.target.value.trim() === '' || !Number.isFinite(typed)) return;
              const next = clean(typed);
              if (next >= limits.min && next <= limits.max) change(next);
            }}
            // Selecting everything on focus makes typing a new value a single step.
            onFocus={(e) => e.currentTarget.select()}
            // However it was left, show the value that actually counts.
            onBlur={() => setDraft(shown.toFixed(decimals))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
          {/* Always there, even without a unit, so every box lines up with the others. */}
          <span className="unit">{unit ?? ''}</span>
        </span>
      </div>
    </div>
  );
}

/** Seconds as m:ss. */
const formatClock = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** Whole seconds left until `startsAt` (a server time), or null when there is no countdown. */
export function useCountdown(startsAt: number | null, clockOffset: number): number | null {
  const [, tick] = useState(0);
  useEffect(() => {
    if (startsAt === null) return;
    const id = setInterval(() => tick((n) => n + 1), 200);
    return () => clearInterval(id);
  }, [startsAt]);
  if (startsAt === null) return null;
  return Math.max(0, Math.ceil((startsAt - (Date.now() + clockOffset)) / 1000));
}

/**
 * How many times `value` has changed since this component appeared (0 until the first change),
 * and whether the latest change was an increase.
 */
function useCountBump(value: number): { changes: number; grew: boolean } {
  const [state, setState] = useState({ changes: 0, grew: true });
  const previous = useRef(value);
  useEffect(() => {
    if (previous.current === value) return;
    const grew = value > previous.current;
    previous.current = value;
    setState((s) => ({ changes: s.changes + 1, grew }));
  }, [value]);
  return state;
}
