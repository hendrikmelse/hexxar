import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * How long a restart usually takes, learned from the ones before it, so players can be told. A
 * restart is timed from the moment the old server is told to stop to the moment the new one is
 * listening, and the last few are kept next to the saved matches.
 */

/** What to say before any restart has been timed. */
export const DEFAULT_RESTART_MS = 10_000;
/** Browsers retry a second or so after the server is up; that is part of the wait too. */
const RECONNECT_ALLOWANCE_MS = 1000;
/** How many restarts are remembered. */
const KEEP = 9;
/** A gap longer than this was not a restart, but the server being off for a while. */
const LONGEST_RESTART_MS = 10 * 60_000;

export interface RestartLog {
  /** When the server was last told to stop, until the next one has started. */
  stoppedAt: number | null;
  /** How long the last restarts took, oldest first. */
  durationsMs: number[];
}

export function readRestartLog(file: string): RestartLog {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<RestartLog>;
    return {
      stoppedAt: typeof parsed.stoppedAt === 'number' ? parsed.stoppedAt : null,
      durationsMs: Array.isArray(parsed.durationsMs)
        ? parsed.durationsMs.filter((n) => typeof n === 'number' && n >= 0)
        : [],
    };
  } catch {
    return { stoppedAt: null, durationsMs: [] };
  }
}

function writeRestartLog(file: string, log: RestartLog): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    const partial = `${file}.partial`;
    writeFileSync(partial, JSON.stringify(log));
    renameSync(partial, file);
  } catch (error) {
    console.error('the restart timing could not be saved', error);
  }
}

/** What to tell players: the usual time (the middle one of the last few), rounded up to a second. */
export function estimateRestartMs(log: RestartLog): number {
  const sorted = [...log.durationsMs].sort((a, b) => a - b);
  const typical = sorted.length === 0 ? DEFAULT_RESTART_MS : sorted[Math.floor(sorted.length / 2)]!;
  return Math.ceil((typical + RECONNECT_ALLOWANCE_MS) / 1000) * 1000;
}

/** The server was told to stop: note the time, and return what players should be told. */
export function markStopping(file: string, now = Date.now()): number {
  const log = readRestartLog(file);
  writeRestartLog(file, { ...log, stoppedAt: now });
  return estimateRestartMs(log);
}

/** The server is listening: if it was started by a restart, that restart's time is now known. */
export function markStarted(file: string, now = Date.now()): void {
  const log = readRestartLog(file);
  if (log.stoppedAt === null) return;
  const took = now - log.stoppedAt;
  const durationsMs =
    took >= 0 && took <= LONGEST_RESTART_MS
      ? [...log.durationsMs, took].slice(-KEEP)
      : log.durationsMs;
  writeRestartLog(file, { stoppedAt: null, durationsMs });
  console.log(`restart took ${Math.round(took / 100) / 10}s`);
}
