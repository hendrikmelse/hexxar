import { useEffect, useState } from 'react';
import { MAX_ROOM_RADIUS, MIN_ROOM_RADIUS, type RoomMode, type RoomView } from '@hexxar/shared';
import { useApp } from '../store.js';
import type { Actions } from './App.js';

const RADII = [5, 6, 7, 8, 9, 10, 12].filter((r) => r >= MIN_ROOM_RADIUS && r <= MAX_ROOM_RADIUS);
const TICKS_MS = [500, 1000, 2000, 3000, 5000];
const SPEEDS = [50, 100, 150, 200];
const STARTING_TROOPS = [5, 10, 20, 30];

const tilesOnBoard = (radius: number): number => 3 * radius * (radius + 1) + 1;

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
  const seconds = useCountdown(room.startsAt, app.clockOffset);
  const earlySeconds = useCountdown(room.earlyStartAt, app.clockOffset);

  return (
    <div className="screen">
      <div className="card lobby">
        <h2>
          {isPrivate
            ? `Private ${mode === 'ffa' ? 'free-for-all' : 'duel'}`
            : mode === 'ffa'
              ? 'Free-for-all'
              : 'Looking for an opponent…'}
        </h2>
        {mode === 'ffa' && (
          <p className="muted">
            {players} of {size} players · needs at least {room.minPlayers} to start
          </p>
        )}

        {isPrivate && <InviteCode code={room.code} />}

        <ul className="players">
          {room.players.map((p) => (
            <li key={p.userId} className={p.connected ? '' : 'away'}>
              <span>{p.name}</span>
              {p.userId === room.host && isPrivate && <em>host</em>}
              {p.userId === room.you && <em>you</em>}
              {!p.connected && <em>disconnected</em>}
            </li>
          ))}
          {/* Big rooms just say how many spots are left, rather than listing every empty slot. */}
          {size <= 6 &&
            Array.from({ length: size - players }, (_, i) => (
              <li key={`open-${i}`} className="open">
                Waiting for a player…
              </li>
            ))}
        </ul>

        {isPrivate && <Settings room={room} editable={editable} onChange={actions.updateRoom} />}

        {app.error && <p className="error">{app.error}</p>}

        {room.state === 'starting' && seconds !== null && (
          <p className="countdown">Starting in {seconds}…</p>
        )}
        {room.state === 'lobby' && earlySeconds !== null && (
          <p className="muted">
            Starting without the rest in {earlySeconds}s, unless someone else joins first
          </p>
        )}

        <div className="buttons">
          {isHost && isPrivate && room.state === 'lobby' && (
            <button className="primary" disabled={!canStart} onClick={actions.startGame}>
              {canStart
                ? mode === 'ffa'
                  ? `Start game (${players} players)`
                  : 'Start game'
                : 'Waiting for players'}
            </button>
          )}
          <button onClick={actions.leaveRoom}>Leave</button>
        </div>
      </div>
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
      <button onClick={copy}>{copied ? 'Copied!' : 'Copy invite link'}</button>
    </div>
  );
}

function Settings({
  room,
  editable,
  onChange,
}: {
  room: RoomView;
  editable: boolean;
  onChange: Actions['updateRoom'];
}) {
  const { mode, radius, config } = room.settings;
  return (
    <div className="settings">
      <label className="field row">
        <span>Game mode</span>
        <select
          value={mode}
          disabled={!editable}
          onChange={(e) => onChange({ mode: e.target.value as RoomMode })}
        >
          <option value="duel">Duel (2 players)</option>
          <option value="ffa">Free-for-all (up to 12)</option>
        </select>
      </label>
      {/* Free-for-all boards are sized by the number of players. */}
      {mode === 'duel' && (
        <Setting
          label="Board size"
          value={radius}
          options={RADII}
          format={(r) => `${r} (${tilesOnBoard(r)} tiles)`}
          disabled={!editable}
          onChange={(value) => onChange({ radius: value })}
        />
      )}
      <Setting
        label="Tick length"
        value={config.tickMs}
        options={TICKS_MS}
        format={(ms) => `${ms / 1000}s`}
        disabled={!editable}
        onChange={(value) => onChange({ config: { tickMs: value } })}
      />
      <Setting
        label="Troop production"
        value={config.generationSpeedPercent}
        options={SPEEDS}
        format={(p) => `${p}%`}
        disabled={!editable}
        onChange={(value) => onChange({ config: { generationSpeedPercent: value } })}
      />
      <Setting
        label="Starting troops"
        value={config.startingTroops}
        options={STARTING_TROOPS}
        format={(n) => String(n)}
        disabled={!editable}
        onChange={(value) => onChange({ config: { startingTroops: value } })}
      />
    </div>
  );
}

function Setting({
  label,
  value,
  options,
  format,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  options: number[];
  format: (value: number) => string;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  // Keep a value chosen some other way selectable.
  const all = options.includes(value) ? options : [...options, value].sort((a, b) => a - b);
  return (
    <label className="field row">
      <span>{label}</span>
      <select value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))}>
        {all.map((option) => (
          <option key={option} value={option}>
            {format(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Whole seconds left until `startsAt` (a server time), or null when there is no countdown. */
function useCountdown(startsAt: number | null, clockOffset: number): number | null {
  const [, tick] = useState(0);
  useEffect(() => {
    if (startsAt === null) return;
    const id = setInterval(() => tick((n) => n + 1), 200);
    return () => clearInterval(id);
  }, [startsAt]);
  if (startsAt === null) return null;
  return Math.max(0, Math.ceil((startsAt - (Date.now() + clockOffset)) / 1000));
}
