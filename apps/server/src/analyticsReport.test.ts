import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildReport } from './analyticsReport.js';
import { openTestDb } from './test-db.js';

const testDb = await openTestDb();
afterAll(() => testDb?.drop());

const HOUR = 3_600_000;

describe.skipIf(!testDb)('the analytics report', () => {
  const db = testDb!.db;

  /** Put one event in the table, `hoursAgo` hours ago. */
  const put = async (
    visitor: string,
    name: string,
    props: Record<string, unknown> = {},
    hoursAgo = 2,
    internal = false,
  ): Promise<void> => {
    await db.query(
      `INSERT INTO events (at, visitor_id, session_id, name, props, internal)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [new Date(Date.now() - hoursAgo * HOUR), visitor, `s-${visitor}`, name, props, internal],
    );
  };

  beforeEach(async () => {
    await db.query('TRUNCATE events');
  });

  it('is empty, and does not fail, with no events', async () => {
    const report = await buildReport(db, 30);
    expect(report.traffic).toMatchObject({ visitors: 0, sessions: 0 });
    expect(report.funnel.visitors).toBe(0);
    expect(report.daily).toEqual([]);
    expect(report.lobbies).toEqual([]);
    expect(report.sessions.avgMatches).toBeNull();
  });

  it('follows visitors from arriving to the tutorial to quickplay', async () => {
    // Ann does the tutorial and then plays; Bob starts it and quits; Cy finishes it but never plays;
    // Dee plays without it; Eve plays before the tutorial, which does not count as after it.
    await put('ann', 'visit', { returning: false, invited: false });
    await put('ann', 'tutorial_start', {}, 5);
    await put('ann', 'tutorial_complete', {}, 4);
    await put('ann', 'menu_action', { action: 'quickplay' }, 3);
    await put('bob', 'visit', { returning: true, invited: false });
    await put('bob', 'tutorial_start');
    await put('bob', 'tutorial_exit', { lesson: 1, step: 2 });
    await put('cy', 'visit', { returning: false, invited: true });
    await put('cy', 'tutorial_start');
    await put('cy', 'tutorial_complete');
    await put('dee', 'visit', { returning: false, invited: false });
    await put('dee', 'menu_action', { action: 'quickplay' });
    await put('eve', 'menu_action', { action: 'quickplay' }, 6);
    await put('eve', 'tutorial_complete', {}, 1);

    const report = await buildReport(db, 7);
    expect(report.funnel).toMatchObject({
      visitors: 5,
      tutorialStarted: 3,
      tutorialCompleted: 3,
      quickplayed: 3,
      completedThenQuickplayed: 1,
    });
    expect(report.traffic).toMatchObject({ returningVisitors: 1, invitedSessions: 1 });
  });

  it('tells where visitors came from, and how far each source got', async () => {
    await put('ann', 'visit', { referrer: 'none', ref: 'cool-games' });
    await put('ann', 'menu_action', { action: 'quickplay' });
    await put('bob', 'visit', { referrer: 'none', ref: 'cool-games' });
    await put('cy', 'visit', { referrer: 'reddit.com' });
    await put('dee', 'visit', { referrer: 'internal' });
    const { sources } = await buildReport(db, 7);
    expect(sources).toEqual([
      expect.objectContaining({ kind: 'link', source: 'cool-games', visitors: 2, quickplayed: 1 }),
      expect.objectContaining({ kind: 'direct', visitors: 1 }),
      expect.objectContaining({ kind: 'site', source: 'reddit.com', visitors: 1 }),
    ]);
  });

  it('leaves out the owner, and anything before the window', async () => {
    await put('ann', 'visit', { returning: false, invited: false });
    await put('me', 'visit', { returning: false, invited: false }, 2, true);
    await put('old', 'visit', { returning: false, invited: false }, 24 * 20);
    expect((await buildReport(db, 7)).traffic.visitors).toBe(1);
    expect((await buildReport(db, 30)).traffic.visitors).toBe(2);
  });

  it('counts where in the tutorial people got to, left and retried', async () => {
    const step = (visitor: string, lesson: number, n: number) =>
      put(visitor, 'tutorial_step', { lesson, step: n });
    await step('ann', 0, 0);
    await step('ann', 0, 1);
    await step('bob', 0, 0);
    await step('bob', 0, 1);
    await put('bob', 'tutorial_retry', { lesson: 0, step: 1 });
    await put('bob', 'tutorial_exit', { lesson: 0, step: 1 });
    expect((await buildReport(db, 7)).tutorial).toEqual([
      { lesson: 0, step: 0, reached: 2, exits: 0, retries: 0 },
      { lesson: 0, step: 1, reached: 2, exits: 1, retries: 1 },
    ]);
  });

  it('says how many who joined a lobby never played, and how long the ones who left had waited', async () => {
    const duel = { visibility: 'public', mode: 'duel' };
    // Ann and Bob play a match from room R1. Cy joins R2 and leaves after 30 seconds. Dee joined R3
    // a minute ago, which is too recent to say anything about.
    for (const who of ['ann', 'bob']) {
      await put(who, 'lobby_join', { ...duel, roomId: 'R1' }, 3);
      await put(who, 'match_start', { ...duel, roomId: 'R1', matchId: 'M1' }, 2);
    }
    await put('cy', 'lobby_join', { ...duel, roomId: 'R2' }, 3);
    await put('cy', 'lobby_leave', { ...duel, roomId: 'R2', role: 'player', waitedMs: 30_000 }, 3);
    await db.query(
      `INSERT INTO events (at, visitor_id, session_id, name, props)
       VALUES (now() - interval '1 minute', 'dee', 's-dee', 'lobby_join', $1)`,
      [{ ...duel, roomId: 'R3' }],
    );
    const [lobby] = (await buildReport(db, 7)).lobbies;
    expect(lobby).toEqual({
      visibility: 'public',
      mode: 'duel',
      joins: 3,
      played: 2,
      leaves: 1,
      avgWaitBeforeLeavingMs: 30_000,
    });
  });

  it('says how matches began and went, counting each match once however many played in it', async () => {
    const base = { visibility: 'public', mode: 'ffa', mapSize: 'normal' };
    for (const who of ['a', 'b', 'c']) {
      await put(who, 'match_start', {
        ...base,
        matchId: 'M1',
        players: 3,
        startReason: 'timer',
        lobbyMs: 70_000,
        belowMinMs: 10_000,
      });
    }
    await put('d', 'match_start', {
      ...base,
      matchId: 'M2',
      players: 5,
      startReason: 'vote',
      lobbyMs: 30_000,
      belowMinMs: 0,
    });
    const outcomes = [
      ['a', 'won'],
      ['b', 'eliminated'],
      ['c', 'surrendered'],
    ] as const;
    for (const [who, outcome] of outcomes) {
      await put(who, 'match_end', {
        ...base,
        matchId: 'M1',
        players: 3,
        durationMs: 120_000,
        outcome,
        endedBy: 'eliminated',
      });
    }
    await put('d', 'match_end', {
      ...base,
      matchId: 'M2',
      players: 5,
      durationMs: 60_000,
      outcome: 'won',
      endedBy: 'afk',
    });

    const report = await buildReport(db, 7);
    expect(report.starts).toEqual([
      {
        visibility: 'public',
        mode: 'ffa',
        matches: 2,
        avgPlayers: 4,
        avgLobbyMs: 50_000,
        avgBelowMinMs: 5000,
        reasons: { timer: 1, vote: 1 },
      },
    ]);
    expect(report.matches).toEqual([
      {
        visibility: 'public',
        mode: 'ffa',
        matches: 2,
        avgDurationMs: 90_000,
        endedBy: { eliminated: 1, afk: 1 },
        outcomes: { won: 2, eliminated: 1, surrendered: 1 },
      },
    ]);
    expect(report.sessions).toMatchObject({ total: 4, withMatch: 4, avgMatches: 1 });
    expect(report.daily.at(-1)?.matches).toBe(2);
  });

  it('compares who chatted with who could have', async () => {
    await put('ann', 'lobby_join', { visibility: 'private', mode: 'duel', roomId: 'R' });
    await put('ann', 'chat_message', { channel: 'lobby', length: 4 });
    await put('ann', 'chat_message', { channel: 'lobby', length: 9 });
    await put('bob', 'lobby_join', { visibility: 'private', mode: 'duel', roomId: 'R' });
    await put('cy', 'spectator_join', { reason: 'started' });
    await put('cy', 'chat_message', { channel: 'spectators', length: 2 });
    await put('dee', 'visit', { returning: false, invited: false });
    expect((await buildReport(db, 7)).chat).toEqual({
      eligible: 3,
      chatted: 2,
      messages: 3,
      byChannel: { lobby: 2, spectators: 1 },
    });
  });

  it('shows what people chose after being out, and how long they watched', async () => {
    const room = { visibility: 'public', mode: 'ffa' };
    await put('ann', 'out_choice', { choice: 'spectate', card: 'defeat', ...room });
    await put('bob', 'out_choice', { choice: 'spectate', card: 'defeat', ...room });
    await put('cy', 'out_choice', { choice: 'menu', card: 'defeat', ...room });
    await put('ann', 'spectate_end', {
      role: 'out',
      watchedMs: 40_000,
      matchOver: true,
      how: 'left',
    });
    await put('bob', 'spectate_end', {
      role: 'out',
      watchedMs: 20_000,
      matchOver: false,
      how: 'left',
    });
    await put('dee', 'spectator_join', { reason: 'started' });
    const { spectating } = await buildReport(db, 7);
    expect(spectating.choices).toEqual([
      { card: 'defeat', choice: 'spectate', count: 2 },
      { card: 'defeat', choice: 'menu', count: 1 },
    ]);
    expect(spectating.watching).toEqual([{ role: 'out', count: 2, avgMs: 30_000, untilEnd: 1 }]);
    expect(spectating.joins).toEqual({ started: 1 });
  });

  it('counts how often the smaller things are used, with what for the support card', async () => {
    await put('ann', 'support_click', { what: 'open' });
    await put('ann', 'support_click', { what: 'pay' });
    await put('bob', 'support_click', { what: 'open' });
    await put('bob', 'feedback_open');
    expect((await buildReport(db, 7)).usage).toEqual({
      'support_click:open': 2,
      'support_click:pay': 1,
      feedback_open: 1,
    });
  });
});
