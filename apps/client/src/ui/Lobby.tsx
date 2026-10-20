import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type { MapSize, RoomMode, RoomPlayer, RoomView } from '@hexxar/shared';
import { playSound } from '../audio/audio.js';
import { paletteColor } from '../board.js';
import { useApp } from '../store.js';
import type { Actions } from './App.js';
import { BotTag } from './BotTag.js';
import { Chat } from './Chat.js';
import { FitText } from './FitText.js';
import { SupportLink } from './Support.js';
import { useFlip } from './useFlip.js';

const MAP_SIZE_LABELS: Record<MapSize, string> = {
  small: 'Small',
  normal: 'Normal',
  large: 'Large',
};
const MODE_LABELS: Record<RoomMode, string> = { duel: 'Duel', ffa: 'Battle Royale' };

/** The room before the match: who is here, the settings, and the wait before it starts. */
/** Someone joining or leaving, and the last seconds of the countdown. */
function useLobbySounds(players: number, waitSeconds: number | null): void {
  const before = useRef(players);
  useEffect(() => {
    if (players > before.current) playSound('lobby.join');
    else if (players < before.current) playSound('lobby.leave');
    before.current = players;
  }, [players]);
  useEffect(() => {
    if (waitSeconds !== null && waitSeconds > 0 && waitSeconds <= 3) playSound('lobby.count');
  }, [waitSeconds]);
}

export function Lobby({ actions }: { actions: Actions }) {
  const app = useApp();
  const room = app.room as RoomView;
  const isHost = room.host === room.you;
  const isPrivate = room.visibility === 'private';
  const editable = isHost && isPrivate && room.state === 'lobby';
  const { mode, size } = room.settings;
  const players = room.players.length;
  // Bots give way to people, so only people fill the places up for someone who wants to join.
  const people = room.players.filter((p) => !p.bot).length;
  const canStart = players >= room.minPlayers;
  const waitSeconds = useCountdown(room.earlyStartAt, app.clockOffset);
  const bump = useCountBump(players);
  const shown = useExitingList(room.players);
  const canVote = mode === 'ffa' && !isPrivate;
  const publicDuel = mode === 'duel' && !isPrivate;
  const waitingForOpponent = publicDuel && players < size;
  useLobbySounds(players, waitSeconds);
  const lockedIn = canVote && room.votesNeeded > 0 && room.startVotes >= room.votesNeeded;

  return (
    <div className="screen">
      <div className="lobby-layout">
        <div className={`card lobby ${isPrivate ? 'compact' : ''}`}>
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
            </>
          )}

          {/* In a private game you know who you are playing with: twelve boxes that fill as people join. */}
          {mode === 'ffa' && isPrivate && <Roster room={room} shown={shown} />}

          {isPrivate && <Settings room={room} editable={editable} onChange={actions.updateRoom} />}

          {/* The timer and the vote are always on screen, so nothing jumps when the third player joins. */}
          {(canVote || publicDuel) && (
            <div
              className={`wait-timer ${lockedIn ? 'locked' : ''} ${waitSeconds === null ? 'paused' : ''}`}
            >
              {/* A duel with nobody across the table yet says so here, in place of the label and number. */}
              {!waitingForOpponent && (
                <span className="wait-label">
                  {lockedIn ? 'Enough votes: starting in' : 'Match starts in'}
                </span>
              )}
              {waitingForOpponent ? (
                <strong className="waiting-text">Waiting for an opponent...</strong>
              ) : (
                <strong>{formatClock(waitSeconds ?? Math.round(room.waitMs / 1000))}</strong>
              )}
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

          {/* Private games always keep the line's place, empty or not, so nothing moves when someone starts watching. */}
          {isPrivate && (
            <p
              className="muted center spectator-count"
              style={room.spectators.length === 0 ? { visibility: 'hidden' } : undefined}
            >
              {room.spectators.length} spectator{room.spectators.length === 1 ? '' : 's'}
              {room.spectating && (
                <>
                  <span className="dot" aria-hidden="true" />
                  You are a spectator
                </>
              )}
            </p>
          )}

          <div className="buttons">
            <button data-sound="ui.back" onClick={actions.leaveRoom}>
              Leave
            </button>
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
            {/* In the bottom right: players can step out to watch, and spectators can take a free place. */}
            {isPrivate && !room.spectating && (
              <button className="side-button" onClick={actions.becomeSpectator}>
                Spectate
              </button>
            )}
            {room.spectating && (
              <Tip text={people < size ? undefined : 'The game is full'}>
                <button
                  className="primary"
                  disabled={people >= size}
                  onClick={actions.becomePlayer}
                >
                  Join as player
                </button>
              </Tip>
            )}
          </div>

          {/* Laid over the card's bottom padding, as far from the edge as on the title screen. */}
          <SupportLink />
        </div>
        {/* Everyone in the room talks together until the match starts. */}
        {room.canChat && <Chat actions={actions} title="Chat" />}
      </div>
      <BotOffer
        // Only quick play lobbies offer it, and only while they cannot start.
        show={!isPrivate && room.state === 'lobby' && !canStart && !room.spectating}
        players={players}
        onClick={() => actions.playWithBots(mode)}
      />
    </div>
  );
}

/** How long a lobby has to stay short of players before bots are offered. */
const BOT_OFFER_DELAY_MS = 3000;

/**
 * A card at the bottom of the screen, offering a game against bots to someone whose lobby cannot
 * start. It fades in after a few quiet seconds (any change in who is here starts the wait over),
 * and fades out at once when there is no more reason for it.
 */
function BotOffer({
  show,
  players,
  onClick,
}: {
  show: boolean;
  players: number;
  onClick: () => void;
}) {
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    setWaited(false);
    if (!show) return;
    const id = setTimeout(() => setWaited(true), BOT_OFFER_DELAY_MS);
    return () => clearTimeout(id);
  }, [show, players]);
  const visible = show && waited;
  return (
    <div className={`card bot-offer ${visible ? 'visible' : ''}`} aria-hidden={!visible}>
      <strong>Tired of waiting?</strong>
      <button className="primary" tabIndex={visible ? 0 : -1} disabled={!visible} onClick={onClick}>
        Play against bots
      </button>
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
const EXIT_MS = 250;

interface ShownPlayer {
  player: RoomPlayer;
  /** Has just left; kept on screen only for the exit animation. */
  leaving: boolean;
  /** Joined while the lobby was open (so their box pops in). */
  arrived: boolean;
  /** For someone leaving: the place (counting from 0) they were in, which they keep while they pop away. */
  at?: number;
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
      const before = new Map(previous.map((entry) => [entry.player.userId, entry] as const));
      const current = new Set(players.map((p) => p.userId));
      // Everyone who is here, in the order the server lists them (people before bots).
      const next: ShownPlayer[] = players.map((player) => {
        const old = before.get(player.userId);
        return old ? { ...old, player, leaving: false } : { player, leaving: false, arrived: true };
      });
      // Someone who has just left is drawn where they were for as long as their exit animation
      // lasts, but takes no place in the order: everyone else moves up at once.
      const stillHere = previous.filter((entry) => !entry.leaving);
      for (const entry of previous) {
        if (current.has(entry.player.userId)) continue;
        next.push(
          entry.leaving ? entry : { ...entry, leaving: true, at: stillHere.indexOf(entry) },
        );
      }
      return next;
    });
  }, [players]);

  // Each person who left is forgotten once their own exit animation has played, whatever else is
  // going on: a run of people leaving must not hold every one of the empty places back.
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    for (const entry of shown) {
      const id = entry.player.userId;
      const waiting = timers.current.get(id);
      if (entry.leaving && waiting === undefined) {
        timers.current.set(
          id,
          setTimeout(() => {
            timers.current.delete(id);
            setShown((all) => all.filter((e) => !(e.leaving && e.player.userId === id)));
          }, EXIT_MS),
        );
      } else if (!entry.leaving && waiting !== undefined) {
        // Back again before it ran out.
        clearTimeout(waiting);
        timers.current.delete(id);
      }
    }
  }, [shown]);
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => clearTimeout(timer));
  }, []);

  return shown;
}

/**
 * An empty place. Every place is always drawn like this, and a player's box is laid over it, so
 * when someone leaves their place is already there, showing, as their box pops away.
 */
function EmptyBox({ base, children }: { base: string; children?: ReactNode }) {
  return <div className={`${base} open`}>{children}</div>;
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

/** Names are in the colors the players will have in the match. */
function nameColor(player: RoomPlayer): string | undefined {
  if (player.color === null) return undefined;
  return `#${paletteColor(player.color).toString(16).padStart(6, '0')}`;
}

/** Your own box is lit in your color: the glow reads it from `--me` (red, green and blue). */
function meStyle(room: RoomView, player: RoomPlayer): CSSProperties | undefined {
  if (player.userId !== room.you || player.color === null) return undefined;
  const hex = paletteColor(player.color);
  return { '--me': `${hex >> 16} ${(hex >> 8) & 255} ${hex & 255}` } as CSSProperties;
}

/** The box that shows a cut-off name in full: where the name is in its player's box. */
interface NameTip {
  left: number;
  top: number;
  height: number;
  fontSize: string;
}

/** How far the name tooltip's box reaches out around the name it covers. */
const TIP_PAD_X = 10;
const TIP_PAD_Y = 6;

/**
 * One player's box. A name too long for it is cut off with "...", and hovering the box lays a
 * raised box over the name, with the whole name in it, set exactly where the cut-off one was.
 */
function PlayerBox({
  room,
  entry,
  base,
  max,
  min,
  place,
}: {
  room: RoomView;
  entry: ShownPlayer;
  base: 'roster-slot' | 'slot';
  max: number;
  min: number;
  /** The cell of the grid to sit in (over the empty place that is always there). */
  place: CSSProperties;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [clipped, setClipped] = useState(false);
  const [tip, setTip] = useState<NameTip | null>(null);
  // Kept in place once measured, so it can fade away as well as in.
  const [tipShown, setTipShown] = useState(false);
  const { player } = entry;

  const showTip = (): void => {
    const name = box.current?.querySelector<HTMLElement>('.name');
    if (!clipped || !box.current || !name) return;
    const outer = box.current.getBoundingClientRect();
    const inner = name.getBoundingClientRect();
    setTip({
      left: inner.left - outer.left,
      top: inner.top - outer.top,
      height: inner.height,
      fontSize: getComputedStyle(name).fontSize,
    });
    setTipShown(true);
  };

  return (
    <div
      ref={box}
      data-flip={entry.leaving ? undefined : player.userId}
      style={{ ...meStyle(room, player), ...place }}
      className={`${base} name-tip ${boxClass(entry, player.connected)} ${player.userId === room.you ? 'me' : ''}`}
      onMouseEnter={showTip}
      onMouseLeave={() => setTipShown(false)}
    >
      <FitText
        className="name"
        text={player.name}
        max={max}
        min={min}
        color={nameColor(player)}
        bot={player.bot}
        onClip={setClipped}
      />
      {!player.connected && <em>disconnected</em>}
      {clipped && (
        <span
          className={`name-full ${tipShown ? 'shown' : ''}`}
          aria-hidden="true"
          style={
            {
              left: (tip?.left ?? 0) - TIP_PAD_X,
              top: (tip?.top ?? 0) - TIP_PAD_Y,
              padding: `${TIP_PAD_Y}px ${TIP_PAD_X}px`,
              height: tip?.height ?? 0,
              lineHeight: `${tip?.height ?? 0}px`,
              fontSize: tip?.fontSize,
              '--tip-color': nameColor(player),
            } as CSSProperties
          }
        >
          {player.bot && (
            <>
              <BotTag />{' '}
            </>
          )}
          {player.name}
        </span>
      )}
    </div>
  );
}

/**
 * A grid of boxes, one per place in the game. Every place is drawn empty, always; players' boxes
 * sit over their places, so a place someone has left is simply uncovered.
 */
function Roster({ room, shown }: { room: RoomView; shown: ShownPlayer[] }) {
  const grid = useRef<HTMLDivElement>(null);
  useFlip(grid, room.id);
  const cell = (index: number): CSSProperties => ({
    gridColumn: (index % 3) + 1,
    gridRow: Math.floor(index / 3) + 1,
  });
  return (
    <div className="roster" ref={grid}>
      {Array.from({ length: room.settings.size }, (_, index) => {
        // The places that must be filled before the game can start wait with the same dots a
        // duel shows for its missing opponent; the rest are just empty.
        const needed = index < room.minPlayers;
        return (
          <EmptyBox key={`open-${index}`} base={`roster-slot${needed ? ' waiting' : ''}`}>
            {needed && <SearchingDots />}
          </EmptyBox>
        );
      }).map((box, index) => (
        <div key={`cell-${index}`} className="roster-cell" style={cell(index)}>
          {box}
        </div>
      ))}
      {placed(shown).map(({ entry, index }) => (
        <PlayerBox
          key={entry.player.userId}
          room={room}
          entry={entry}
          base="roster-slot"
          max={14}
          min={10}
          place={cell(index)}
        />
      ))}
    </div>
  );
}

/**
 * Where each box goes. Everyone who is here takes the next place in order, so when someone leaves
 * the others move up at once; the person leaving stays in the place they had while they pop away.
 */
function placed(shown: ShownPlayer[]): { entry: ShownPlayer; index: number }[] {
  let next = 0;
  return shown.map((entry) => ({ entry, index: entry.leaving ? (entry.at ?? 0) : next++ }));
}

/**
 * The two sides of a duel, in the order the players joined (the same for everyone, so each box
 * is always the same person), with your own highlighted. A missing opponent shows dots, under
 * the box of whoever is there.
 */
function Versus({ room, shown }: { room: RoomView; shown: ShownPlayer[] }) {
  const sides = [1, 3] as const;
  const area = useRef<HTMLDivElement>(null);
  // A name that has to move (the other player left, or a person took the place of a bot) slides.
  useFlip(area, room.id);
  return (
    // In a private game the panels match the roster's height, so switching mode moves nothing.
    <div ref={area} className={`versus ${room.visibility === 'private' ? 'roster-height' : ''}`}>
      {sides.map((column) => (
        <div
          key={`open-${column}`}
          className="slot-cell"
          style={{ gridColumn: column, gridRow: 1 }}
        >
          <EmptyBox base="slot">
            <SearchingDots />
          </EmptyBox>
        </div>
      ))}
      <div className="vs" style={{ gridColumn: 2, gridRow: 1 }}>
        VS
      </div>
      {placed(shown)
        .filter(({ index }) => index < sides.length)
        .map(({ entry, index }) => (
          <PlayerBox
            key={entry.player.userId}
            room={room}
            entry={entry}
            base="slot"
            max={15}
            min={11}
            place={{ gridColumn: sides[index], gridRow: 1 }}
          />
        ))}
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

/** The numbers the starting troops buttons go through: 1, then every fifth number. A typed number can be anything. */
const TROOP_STOPS: readonly number[] = [1, ...Array.from({ length: 20 }, (_, i) => (i + 1) * 5)];

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
  const { mode, mapSize, bots, size, config } = room.settings;

  if (!editable) {
    return (
      <dl className="game-info">
        <dt>Game mode</dt>
        <dd>{MODE_LABELS[mode]}</dd>
        <dt>Map size</dt>
        <dd>{MAP_SIZE_LABELS[mapSize]}</dd>
        {bots > 0 && (
          <>
            <dt>Bots</dt>
            <dd>{bots}</dd>
          </>
        )}
        <dt>Fog of war</dt>
        <dd>{config.fog === 'on' ? 'On' : 'Off'}</dd>
        <dt>Tick length</dt>
        <dd>{(config.tickMs / 1000).toFixed(1)}s</dd>
        <dt>Starting troops</dt>
        <dd>{config.startingTroops}</dd>
      </dl>
    );
  }

  // Bots only ever take places nobody is playing in: the host's own place is theirs until they step out to watch.
  const people = room.players.filter((p) => !p.bot).length;
  return (
    <div className="settings">
      <SettingLine label="Game mode">
        <Cycle
          label="Game mode"
          value={mode}
          options={[
            { value: 'duel', label: 'Duel' },
            { value: 'ffa', label: 'Battle Royale' },
          ]}
          onChange={(value) => onChange({ mode: value })}
        />
      </SettingLine>
      <SettingLine label="Map size">
        <Cycle
          label="Map size"
          value={mapSize}
          options={(Object.keys(MAP_SIZE_LABELS) as MapSize[]).map((value) => ({
            value,
            label: MAP_SIZE_LABELS[value],
          }))}
          onChange={(value) => onChange({ mapSize: value })}
        />
      </SettingLine>
      <SettingLine label="Fog of war">
        <Switch
          label="Fog of war"
          checked={config.fog === 'on'}
          onChange={(on) => onChange({ config: { fog: on ? 'on' : 'off' } })}
        />
      </SettingLine>
      <SettingLine label="Bots">
        <Stepper
          label="Number of bots"
          value={bots}
          min={0}
          max={Math.max(bots, size - people)}
          step={1}
          decimals={0}
          onChange={(count) => onChange({ bots: count })}
        />
      </SettingLine>
      <SettingLine label="Tick length">
        <Stepper
          label="Tick length"
          value={config.tickMs / 1000}
          min={0.4}
          max={5}
          step={0.1}
          decimals={1}
          unit="s"
          typeable
          onChange={(seconds) => onChange({ config: { tickMs: Math.round(seconds * 1000) } })}
        />
      </SettingLine>
      <SettingLine label="Starting troops">
        <Stepper
          label="Starting troops"
          value={config.startingTroops}
          min={1}
          max={100}
          stops={TROOP_STOPS}
          step={5}
          decimals={0}
          typeable
          onChange={(startingTroops) => onChange({ config: { startingTroops } })}
        />
      </SettingLine>
    </div>
  );
}

/** One option on one line: its name on the left, and whatever changes it on the right. */
function SettingLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="setting-line">
      <span className="setting-name">{label}</span>
      <div className="setting-control">{children}</div>
    </div>
  );
}

/**
 * An on/off switch: a short track with a knob that slides from one end to the other. The whole
 * track is the button, so clicking anywhere on it flips it. The knob says where it is.
 */
function Switch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-knob">{checked ? 'On' : 'Off'}</span>
    </button>
  );
}

/**
 * One button that shows the current option and goes on to the next each time it is clicked. Every
 * option's label sits in the button (only the current one shows), so it is always as wide as the
 * longest and never changes size.
 */
function Cycle<T extends string>({
  label,
  value,
  options,
  className,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  className?: string;
  onChange: (value: T) => void;
}) {
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const next = options[(index + 1) % options.length]!;
  return (
    <button
      type="button"
      className={`cycle ${className ?? ''}`}
      aria-label={`${label}: ${options[index]!.label}. Click for ${next.label}.`}
      onClick={() => onChange(next.value)}
    >
      {options.map((option) => (
        <span key={option.value} className={option.value === value ? 'on' : ''}>
          {option.label}
        </span>
      ))}
    </button>
  );
}

/** A bar of options, one of which is selected; click another to switch. */
export function Segmented<T extends string | number>({
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

/**
 * A number with a "-" button on one side and a "+" on the other. Clicks show at once, and each
 * one goes to the server as the new value (the server's answer settles it). A button is off at
 * the end of its range. With `stops`, the buttons go through those numbers instead of by `step`.
 * With `typeable`, the number can also be typed (it is kept within the range when you are done).
 */
function Stepper({
  label,
  value,
  min,
  max,
  step,
  stops,
  decimals,
  unit,
  typeable,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  stops?: readonly number[];
  decimals: number;
  unit?: string;
  typeable?: boolean;
  onChange: (value: number) => void;
}) {
  const [shown, setShown] = useState(value);
  const [draft, setDraft] = useState(value.toFixed(decimals));
  // Follow the server's value whenever it changes.
  useEffect(() => setShown(value), [value]);
  useEffect(() => setDraft(shown.toFixed(decimals)), [shown, decimals]);

  /** Round to the step, so values like 0.30000000000000004 never go anywhere. */
  const clean = (n: number): number => Number((Math.round(n / step) * step).toFixed(6));
  const up = stops
    ? stops.find((stop) => stop > shown + 1e-9)
    : shown + step <= max + 1e-9
      ? clean(shown + step)
      : undefined;
  const down = stops
    ? [...stops].reverse().find((stop) => stop < shown - 1e-9)
    : shown - step >= min - 1e-9
      ? clean(shown - step)
      : undefined;

  const set = (next: number): void => {
    if (next === shown) return;
    setShown(next);
    onChange(next);
  };
  const commit = (): void => {
    const typed = Number(draft.trim().replace(',', '.'));
    if (draft.trim() === '' || !Number.isFinite(typed)) {
      setDraft(shown.toFixed(decimals));
      return;
    }
    const next = Number(Math.min(max, Math.max(min, typed)).toFixed(decimals));
    setDraft(next.toFixed(decimals));
    set(next);
  };

  return (
    <div className="stepper" role="group" aria-label={label}>
      <button
        type="button"
        className="stepper-less"
        aria-label={`Less ${label}`}
        disabled={down === undefined}
        onClick={() => down !== undefined && set(down)}
      />
      {typeable ? (
        <span className="stepper-value">
          <input
            type="text"
            inputMode={decimals > 0 ? 'decimal' : 'numeric'}
            aria-label={label}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            // Selecting everything on focus makes typing a new value a single step.
            onFocus={(e) => e.currentTarget.select()}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
          {unit && <span className="unit">{unit}</span>}
        </span>
      ) : (
        <output className="stepper-value" aria-live="polite">
          {shown.toFixed(decimals)}
          {unit}
        </output>
      )}
      <button
        type="button"
        className="stepper-more"
        aria-label={`More ${label}`}
        disabled={up === undefined}
        onClick={() => up !== undefined && set(up)}
      />
    </div>
  );
}

/** Seconds as m:ss. */
const formatClock = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** Whole seconds left until `endsAt` (a server time), or null when there is no countdown. */
function useCountdown(endsAt: number | null, clockOffset: number): number | null {
  const [, tick] = useState(0);
  useEffect(() => {
    if (endsAt === null) return;
    const id = setInterval(() => tick((n) => n + 1), 200);
    return () => clearInterval(id);
  }, [endsAt]);
  if (endsAt === null) return null;
  return Math.max(0, Math.ceil((endsAt - (Date.now() + clockOffset)) / 1000));
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
