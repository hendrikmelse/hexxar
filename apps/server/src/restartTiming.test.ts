import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RESTART_MS,
  estimateRestartMs,
  markStarted,
  markStopping,
  readRestartLog,
} from './restartTiming.js';

describe('restart timing', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hexxar-timing-'));
    file = join(dir, 'restarts.json');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  /** One restart that took `ms`; returns what players were told at its start. */
  const restart = (ms: number, at = 1_000_000): number => {
    const told = markStopping(file, at);
    markStarted(file, at + ms);
    return told;
  };

  it('guesses before any restart has been timed', () => {
    expect(markStopping(file, 1000)).toBe(Math.ceil((DEFAULT_RESTART_MS + 1000) / 1000) * 1000);
  });

  it('tells players the usual time, from the restarts before', () => {
    restart(8000);
    restart(9000);
    restart(30_000); // one slow outlier
    expect(restart(8500)).toBe(10_000); // the middle of 8000, 8500?, 9000, 30000
    expect(readRestartLog(file).durationsMs).toEqual([8000, 9000, 30_000, 8500]);
  });

  it('keeps only the last few', () => {
    for (let i = 1; i <= 12; i++) restart(i * 1000);
    expect(readRestartLog(file).durationsMs).toHaveLength(9);
    expect(readRestartLog(file).durationsMs.at(-1)).toBe(12_000);
  });

  it('does not count a start that no restart led to, or a very long gap', () => {
    markStarted(file, 5000);
    expect(readRestartLog(file).durationsMs).toEqual([]);
    markStopping(file, 1000);
    markStarted(file, 1000 + 3 * 60 * 60_000);
    expect(readRestartLog(file).durationsMs).toEqual([]);
    expect(readRestartLog(file).stoppedAt).toBeNull();
  });

  it('copes with a missing or damaged file', () => {
    expect(estimateRestartMs(readRestartLog(join(dir, 'nothing.json')))).toBeGreaterThan(0);
    expect(readRestartLog(dir)).toEqual({ stoppedAt: null, durationsMs: [] });
  });
});
