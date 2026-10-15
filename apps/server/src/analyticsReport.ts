import type {
  AnalyticsFunnel,
  AnalyticsLobby,
  AnalyticsMatches,
  AnalyticsReport,
  AnalyticsStarts,
} from '@hexxar/shared';
import type { Db } from './db.js';

/** A lobby needs this long before "did they play" is a fair question: it may still be filling up. */
const SETTLE_MINUTES = 10;

type Row = Record<string, string | number | boolean | null>;

/** Add `count` under `key` in a record that is being built up. */
function bump(record: Record<string, number>, key: string | null, count: number): void {
  if (key !== null) record[key] = (record[key] ?? 0) + count;
}

/**
 * The numbers the admin panel's analytics tab shows, for the last `days` days: one query for each
 * question. Everything leaves out events marked internal (the owner's own).
 */
export async function buildReport(db: Db, days: number): Promise<AnalyticsReport> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const q = async (sql: string, extra: unknown[] = []): Promise<Row[]> =>
    (await db.query<Row>(sql, [since, ...extra])).rows;
  // Every query starts from the same place: this window of time, without internal events.
  const events = `FROM events WHERE NOT internal AND at >= $1`;

  const [
    daily,
    traffic,
    funnel,
    sources,
    completedQuickplay,
    tutorial,
    lobbyJoins,
    lobbyLeaves,
    starts,
    matchRows,
    outcomeRows,
    sessions,
    chat,
    chatChannels,
    choices,
    watching,
    spectatorJoins,
    usage,
  ] = await Promise.all([
    q(`SELECT to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
              count(DISTINCT visitor_id)::int AS visitors,
              count(DISTINCT props->>'matchId') FILTER (WHERE name = 'match_start')::int AS matches
       ${events} GROUP BY 1 ORDER BY 1`),
    q(`SELECT count(DISTINCT visitor_id)::int AS visitors,
              count(DISTINCT session_id)::int AS sessions,
              count(DISTINCT visitor_id) FILTER (WHERE name = 'visit' AND (props->>'returning')::boolean)::int AS returning,
              count(DISTINCT session_id) FILTER (WHERE name = 'visit' AND (props->>'invited')::boolean)::int AS invited,
              count(DISTINCT visitor_id) FILTER (WHERE name = 'visit' AND props->>'blocked' = 'phone')::int AS phones
       ${events}`),
    q(`SELECT count(DISTINCT visitor_id)::int AS visitors,
              count(DISTINCT visitor_id) FILTER (WHERE name = 'tutorial_start')::int AS tutorial_started,
              count(DISTINCT visitor_id) FILTER (WHERE name = 'tutorial_complete')::int AS tutorial_completed,
              count(DISTINCT visitor_id) FILTER (WHERE name = 'menu_action' AND props->>'action' = 'quickplay')::int AS quickplayed,
              count(DISTINCT visitor_id) FILTER (WHERE name = 'lobby_join')::int AS joined,
              count(DISTINCT visitor_id) FILTER (WHERE name = 'match_start')::int AS played
       ${events}`),
    q(`WITH v AS (
         SELECT DISTINCT visitor_id,
                CASE WHEN coalesce(props->>'ref', '') <> '' THEN 'link'
                     WHEN coalesce(props->>'referrer', 'none') NOT IN ('none', 'internal') THEN 'site'
                     ELSE 'direct' END AS kind,
                CASE WHEN coalesce(props->>'ref', '') <> '' THEN props->>'ref'
                     WHEN coalesce(props->>'referrer', 'none') NOT IN ('none', 'internal') THEN props->>'referrer'
                     ELSE '' END AS source
         ${events} AND name = 'visit'
       ), f AS (
         SELECT visitor_id,
                bool_or(name = 'tutorial_complete') AS tutorial,
                bool_or(name = 'menu_action' AND props->>'action' = 'quickplay') AS quickplay,
                bool_or(name = 'match_start') AS played
         ${events} GROUP BY visitor_id
       )
       SELECT v.kind, v.source, count(*)::int AS visitors,
              count(*) FILTER (WHERE f.tutorial)::int AS tutorial,
              count(*) FILTER (WHERE f.quickplay)::int AS quickplay,
              count(*) FILTER (WHERE f.played)::int AS played
       FROM v JOIN f USING (visitor_id)
       GROUP BY 1, 2 ORDER BY visitors DESC, 2 LIMIT 50`),
    q(`SELECT count(DISTINCT c.visitor_id)::int AS n
       FROM events c
       JOIN events p ON p.visitor_id = c.visitor_id AND p.name = 'menu_action'
                    AND p.props->>'action' = 'quickplay' AND p.at > c.at AND NOT p.internal
       WHERE c.name = 'tutorial_complete' AND NOT c.internal AND c.at >= $1`),
    q(`SELECT (props->>'lesson')::int AS lesson, (props->>'step')::int AS step,
              count(DISTINCT session_id) FILTER (WHERE name = 'tutorial_step')::int AS reached,
              count(*) FILTER (WHERE name = 'tutorial_exit')::int AS exits,
              count(*) FILTER (WHERE name = 'tutorial_retry')::int AS retries
       ${events} AND name IN ('tutorial_step', 'tutorial_exit', 'tutorial_retry') AND props ? 'lesson'
       GROUP BY 1, 2 ORDER BY 1, 2`),
    q(
      `WITH joins AS (
         SELECT DISTINCT ON (visitor_id, props->>'roomId')
                visitor_id, props->>'roomId' AS room, props->>'visibility' AS visibility, props->>'mode' AS mode
         ${events} AND name = 'lobby_join' AND at < now() - make_interval(mins => $2)
         ORDER BY visitor_id, props->>'roomId', at
       ), played AS (
         SELECT DISTINCT visitor_id, props->>'roomId' AS room ${events} AND name = 'match_start'
       )
       SELECT j.visibility, j.mode, count(*)::int AS joins, count(p.room)::int AS played
       FROM joins j LEFT JOIN played p ON p.visitor_id = j.visitor_id AND p.room = j.room
       GROUP BY 1, 2`,
      [SETTLE_MINUTES],
    ),
    q(`SELECT props->>'visibility' AS visibility, props->>'mode' AS mode, count(*)::int AS leaves,
              avg((props->>'waitedMs')::numeric)::float8 AS avg_wait
       ${events} AND name = 'lobby_leave' AND props->>'role' = 'player' GROUP BY 1, 2`),
    q(`WITH m AS (
         SELECT DISTINCT ON (props->>'matchId') props
         ${events} AND name = 'match_start' ORDER BY props->>'matchId', at
       )
       SELECT props->>'visibility' AS visibility, props->>'mode' AS mode, props->>'startReason' AS reason,
              count(*)::int AS matches,
              avg((props->>'players')::numeric)::float8 AS avg_players,
              avg((props->>'lobbyMs')::numeric)::float8 AS avg_lobby,
              avg((props->>'belowMinMs')::numeric)::float8 AS avg_below
       FROM m GROUP BY 1, 2, 3`),
    q(`WITH m AS (
         SELECT DISTINCT ON (props->>'matchId') props
         ${events} AND name = 'match_end' ORDER BY props->>'matchId', at
       )
       SELECT props->>'visibility' AS visibility, props->>'mode' AS mode, props->>'endedBy' AS ended_by,
              count(*)::int AS matches, avg((props->>'durationMs')::numeric)::float8 AS avg_duration
       FROM m GROUP BY 1, 2, 3`),
    q(`SELECT props->>'visibility' AS visibility, props->>'mode' AS mode, props->>'outcome' AS outcome,
              count(*)::int AS n
       ${events} AND name = 'match_end' GROUP BY 1, 2, 3`),
    q(`WITH s AS (
         SELECT session_id, count(DISTINCT props->>'matchId') FILTER (WHERE name = 'match_start') AS matches
         ${events} GROUP BY session_id
       )
       SELECT count(*)::int AS total, count(*) FILTER (WHERE matches > 0)::int AS with_match,
              (avg(matches) FILTER (WHERE matches > 0))::float8 AS avg_matches
       FROM s`),
    q(`WITH v AS (
         SELECT visitor_id,
                bool_or(name IN ('lobby_join', 'spectator_join')) AS eligible,
                bool_or(name = 'chat_message') AS chatted,
                count(*) FILTER (WHERE name = 'chat_message') AS messages
         ${events} GROUP BY visitor_id
       )
       SELECT count(*) FILTER (WHERE eligible)::int AS eligible,
              count(*) FILTER (WHERE eligible AND chatted)::int AS chatted,
              coalesce(sum(messages), 0)::int AS messages
       FROM v`),
    q(`SELECT props->>'channel' AS channel, count(*)::int AS n
       ${events} AND name = 'chat_message' GROUP BY 1`),
    q(`SELECT props->>'card' AS card, props->>'choice' AS choice, count(*)::int AS n
       ${events} AND name = 'out_choice' GROUP BY 1, 2 ORDER BY 1, 3 DESC`),
    q(`SELECT props->>'role' AS role, count(*)::int AS n,
              avg((props->>'watchedMs')::numeric)::float8 AS avg_ms,
              count(*) FILTER (WHERE (props->>'matchOver')::boolean)::int AS until_end
       ${events} AND name = 'spectate_end' GROUP BY 1`),
    q(`SELECT props->>'reason' AS reason, count(*)::int AS n
       ${events} AND name = 'spectator_join' GROUP BY 1`),
    q(`SELECT name || coalesce(':' || (props->>'what'), '') AS key, count(*)::int AS n
       ${events} AND name IN ('feedback_open', 'feedback_submit', 'support_click', 'sound_toggle',
                              'fullscreen_toggle', 'chat_toggle', 'vote_start', 'invite_link_open')
       GROUP BY 1`),
  ]);

  const num = (value: unknown): number => Number(value ?? 0);
  const orNull = (value: unknown): number | null => (value === null ? null : Number(value));

  const funnelRow = funnel[0]!;
  const funnelOut: AnalyticsFunnel = {
    visitors: num(funnelRow.visitors),
    tutorialStarted: num(funnelRow.tutorial_started),
    tutorialCompleted: num(funnelRow.tutorial_completed),
    quickplayed: num(funnelRow.quickplayed),
    completedThenQuickplayed: num(completedQuickplay[0]?.n),
    joinedLobby: num(funnelRow.joined),
    playedMatch: num(funnelRow.played),
  };

  // Lobbies: joins and what became of them, with the people who left and how long they had waited.
  const lobbyKey = (row: Row): string => `${row.visibility}/${row.mode}`;
  const lobbies = new Map<string, AnalyticsLobby>();
  for (const row of lobbyJoins) {
    lobbies.set(lobbyKey(row), {
      visibility: String(row.visibility),
      mode: String(row.mode),
      joins: num(row.joins),
      played: num(row.played),
      leaves: 0,
      avgWaitBeforeLeavingMs: null,
    });
  }
  for (const row of lobbyLeaves) {
    const base = lobbies.get(lobbyKey(row)) ?? {
      visibility: String(row.visibility),
      mode: String(row.mode),
      joins: 0,
      played: 0,
      leaves: 0,
      avgWaitBeforeLeavingMs: null,
    };
    lobbies.set(lobbyKey(row), {
      ...base,
      leaves: num(row.leaves),
      avgWaitBeforeLeavingMs: orNull(row.avg_wait),
    });
  }

  // How matches began, by kind, folded from one row per start reason.
  const startsByKind = new Map<string, AnalyticsStarts & { reasons: Record<string, number> }>();
  const startTotals = new Map<string, { players: number; lobby: number; below: number }>();
  for (const row of starts) {
    const key = lobbyKey(row);
    const matches = num(row.matches);
    const current = startsByKind.get(key) ?? {
      visibility: String(row.visibility),
      mode: String(row.mode),
      matches: 0,
      avgPlayers: null,
      avgLobbyMs: null,
      avgBelowMinMs: null,
      reasons: {},
    };
    bump(current.reasons, row.reason as string | null, matches);
    const totals = startTotals.get(key) ?? { players: 0, lobby: 0, below: 0 };
    totals.players += num(row.avg_players) * matches;
    totals.lobby += num(row.avg_lobby) * matches;
    totals.below += num(row.avg_below) * matches;
    startTotals.set(key, totals);
    startsByKind.set(key, { ...current, matches: current.matches + matches });
  }
  const startsOut = [...startsByKind.entries()].map(([key, kind]) => {
    const totals = startTotals.get(key)!;
    return {
      ...kind,
      avgPlayers: kind.matches ? totals.players / kind.matches : null,
      avgLobbyMs: kind.matches ? totals.lobby / kind.matches : null,
      avgBelowMinMs: kind.matches ? totals.below / kind.matches : null,
    };
  });

  // How matches went, by kind: durations folded from one row per way of ending.
  const matchesByKind = new Map<
    string,
    AnalyticsMatches & { endedBy: Record<string, number>; outcomes: Record<string, number> }
  >();
  const durationTotals = new Map<string, number>();
  for (const row of matchRows) {
    const key = lobbyKey(row);
    const matches = num(row.matches);
    const current = matchesByKind.get(key) ?? {
      visibility: String(row.visibility),
      mode: String(row.mode),
      matches: 0,
      avgDurationMs: null,
      endedBy: {},
      outcomes: {},
    };
    bump(current.endedBy, row.ended_by as string | null, matches);
    durationTotals.set(key, (durationTotals.get(key) ?? 0) + num(row.avg_duration) * matches);
    matchesByKind.set(key, { ...current, matches: current.matches + matches });
  }
  for (const row of outcomeRows) {
    const kind = matchesByKind.get(lobbyKey(row));
    if (kind) bump(kind.outcomes, row.outcome as string | null, num(row.n));
  }
  const matchesOut = [...matchesByKind.entries()].map(([key, kind]) => ({
    ...kind,
    avgDurationMs: kind.matches ? durationTotals.get(key)! / kind.matches : null,
  }));

  const byChannel: Record<string, number> = {};
  for (const row of chatChannels) bump(byChannel, row.channel as string | null, num(row.n));
  const joins: Record<string, number> = {};
  for (const row of spectatorJoins) bump(joins, row.reason as string | null, num(row.n));
  const usageOut: Record<string, number> = {};
  for (const row of usage) bump(usageOut, row.key as string | null, num(row.n));

  return {
    days,
    generatedAt: Date.now(),
    daily: daily.map((row) => ({
      day: String(row.day),
      visitors: num(row.visitors),
      matches: num(row.matches),
    })),
    traffic: {
      visitors: num(traffic[0]?.visitors),
      sessions: num(traffic[0]?.sessions),
      returningVisitors: num(traffic[0]?.returning),
      invitedSessions: num(traffic[0]?.invited),
      phoneVisitors: num(traffic[0]?.phones),
    },
    funnel: funnelOut,
    sources: sources.map((row) => ({
      kind: row.kind as 'link' | 'site' | 'direct',
      source: String(row.source),
      visitors: num(row.visitors),
      tutorialCompleted: num(row.tutorial),
      quickplayed: num(row.quickplay),
      playedMatch: num(row.played),
    })),
    tutorial: tutorial.map((row) => ({
      lesson: num(row.lesson),
      step: num(row.step),
      reached: num(row.reached),
      exits: num(row.exits),
      retries: num(row.retries),
    })),
    lobbies: [...lobbies.values()],
    starts: startsOut,
    matches: matchesOut,
    sessions: {
      total: num(sessions[0]?.total),
      withMatch: num(sessions[0]?.with_match),
      avgMatches: orNull(sessions[0]?.avg_matches),
    },
    chat: {
      eligible: num(chat[0]?.eligible),
      chatted: num(chat[0]?.chatted),
      messages: num(chat[0]?.messages),
      byChannel,
    },
    spectating: {
      choices: choices.map((row) => ({
        card: String(row.card),
        choice: String(row.choice),
        count: num(row.n),
      })),
      watching: watching.map((row) => ({
        role: String(row.role),
        count: num(row.n),
        avgMs: orNull(row.avg_ms),
        untilEnd: num(row.until_end),
      })),
      joins,
    },
    usage: usageOut,
  };
}
