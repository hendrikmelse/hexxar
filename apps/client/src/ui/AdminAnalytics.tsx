import { useEffect, useState, type ReactNode } from 'react';
import type { AnalyticsReport } from '@hexxar/shared';
import { LESSONS } from '../tutorial/lessons.js';
import { Segmented } from './Lobby.js';

const RANGES = [7, 30, 90, 365] as const;
type Range = (typeof RANGES)[number];

/** "42%", or a dash when there is nothing to divide by. */
const pct = (part: number, whole: number): string =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : '–';

/** "1m 20s", "45s", or a dash. */
function time(ms: number | null): string {
  if (ms === null) return '–';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? `${minutes}m ${seconds % 60}s`
    : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

const number = (value: number | null, digits = 1): string =>
  value === null ? '–' : value.toFixed(digits).replace(/\.0+$/, '');

const kindLabel = (visibility: string, mode: string): string =>
  `${visibility === 'public' ? 'Public' : 'Private'} ${mode === 'ffa' ? 'royale' : 'duel'}`;

/** "full 3, timer 1": a record of counts, biggest first. */
const counts = (record: Readonly<Record<string, number>>): string => {
  const entries = Object.entries(record).sort((a, b) => b[1] - a[1]);
  return entries.length === 0
    ? '–'
    : entries.map(([key, n]) => `${key.replaceAll('_', ' ')} ${n}`).join(', ');
};

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="an-section">
      <h3 className="admin-sub">{title}</h3>
      {note && <p className="muted an-note">{note}</p>}
      {children}
    </section>
  );
}

/** One row of a bar chart: a label, a bar as long as `value` is of `of`, and the numbers. */
function Bar({
  label,
  value,
  of,
  detail,
}: {
  label: string;
  value: number;
  of: number;
  detail?: string;
}) {
  const width = of > 0 ? Math.max(value > 0 ? 1 : 0, (value / of) * 100) : 0;
  return (
    <div className="an-bar">
      <span className="an-bar-label">{label}</span>
      <span className="an-bar-track">
        <span className="an-bar-fill" style={{ width: `${width}%` }} />
      </span>
      <span className="an-bar-value">
        {value} <span className="muted">{detail ?? pct(value, of)}</span>
      </span>
    </div>
  );
}

/** Bars by day: each as tall as its day's value is of the biggest. */
function Daily({
  title,
  days,
  pick,
}: {
  title: string;
  days: AnalyticsReport['daily'];
  pick: (day: AnalyticsReport['daily'][number]) => number;
}) {
  const max = Math.max(1, ...days.map(pick));
  return (
    <div className="an-daily">
      <h4>{title}</h4>
      <div className="an-daily-bars" role="img" aria-label={`${title}, by day`}>
        {days.map((day) => (
          <span
            key={day.day}
            className="an-daily-bar hint"
            style={{ height: `${Math.max(2, (pick(day) / max) * 100)}%` }}
            data-tip={`${day.day}: ${pick(day)}`}
            data-tip-pos="above"
          />
        ))}
      </div>
      <div className="an-daily-axis">
        <span>{days[0]?.day}</span>
        <span>max {max}</span>
        <span>{days.at(-1)?.day}</span>
      </div>
    </div>
  );
}

/** The analytics tab: what the numbers say about how people use the game. */
export function Analytics({
  load,
  ownBrowser,
}: {
  load: (days: number) => Promise<AnalyticsReport>;
  /** Whether this browser is left out of the numbers, and the way to change that. */
  ownBrowser: { available: boolean; on: boolean | null; set: (on: boolean) => void };
}) {
  const [days, setDays] = useState<Range>(30);
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setReport(null);
    const run = (): void => {
      load(days).then(
        (result) => {
          if (!current) return;
          setReport(result);
          setError(null);
        },
        (cause: unknown) => {
          if (current) setError(cause instanceof Error ? cause.message : String(cause));
        },
      );
    };
    run();
    const id = setInterval(run, 30_000);
    return () => {
      current = false;
      clearInterval(id);
    };
  }, [load, days, ownBrowser.on]);

  return (
    <>
      <Segmented
        label="Period"
        value={days}
        options={RANGES.map((range) => ({ value: range, label: `${range} days` }))}
        onChange={setDays}
      />
      {error && (
        <p className="feedback-error" role="alert">
          {error}
        </p>
      )}
      {!report && !error && <p className="muted center">Loading...</p>}
      {report && <Report report={report} />}
      {ownBrowser.available && ownBrowser.on !== null && (
        <label className="an-own">
          <input
            type="checkbox"
            checked={ownBrowser.on}
            onChange={(event) => ownBrowser.set(event.target.checked)}
          />
          Leave this browser out of these numbers (it is mine)
        </label>
      )}
      {!ownBrowser.available && (
        <p className="muted center">
          This browser sends Do Not Track, so it is never recorded and needs no exclusion.
        </p>
      )}
    </>
  );
}

function Report({ report }: { report: AnalyticsReport }) {
  const { traffic, funnel, sessions, chat, spectating, usage } = report;
  if (traffic.visitors === 0) {
    return (
      <p className="muted center">
        No visits recorded in this period yet. Events are collected as people use the game.
      </p>
    );
  }

  const matches = report.matches.reduce((sum, kind) => sum + kind.matches, 0);
  const matchTime = report.matches.reduce(
    (sum, kind) => sum + (kind.avgDurationMs ?? 0) * kind.matches,
    0,
  );
  const tiles: [string, string][] = [
    ['Visitors', String(traffic.visitors)],
    ['Came back', pct(traffic.returningVisitors, traffic.visitors)],
    ['Page loads', String(traffic.sessions)],
    ['Matches', String(matches)],
    ['Average match', matches ? time(matchTime / matches) : '–'],
    ['Loads with match', pct(sessions.withMatch, sessions.total)],
    ['Matches per playing load', number(sessions.avgMatches)],
  ];

  return (
    <>
      <div className="admin-tiles an-tiles">
        {tiles.map(([label, value]) => (
          <div key={label} className="admin-tile">
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>

      <Section
        title="From arriving to playing"
        note="Visitors (browsers), not page loads. Each bar is that step's share of all visitors."
      >
        <div className="an-bars">
          <Bar label="Visited" value={funnel.visitors} of={funnel.visitors} />
          <Bar label="Started the tutorial" value={funnel.tutorialStarted} of={funnel.visitors} />
          <Bar
            label="Finished the tutorial"
            value={funnel.tutorialCompleted}
            of={funnel.visitors}
          />
          <Bar label="Pressed quickplay" value={funnel.quickplayed} of={funnel.visitors} />
          <Bar label="Joined a lobby" value={funnel.joinedLobby} of={funnel.visitors} />
          <Bar label="Played a match" value={funnel.playedMatch} of={funnel.visitors} />
        </div>
        <p className="an-line">
          Of the {funnel.tutorialCompleted} who finished the tutorial,{' '}
          <strong>{funnel.completedThenQuickplayed}</strong> (
          {pct(funnel.completedThenQuickplayed, funnel.tutorialCompleted)}) pressed quickplay
          afterwards. Of the {funnel.tutorialStarted} who started it,{' '}
          <strong>{pct(funnel.tutorialCompleted, funnel.tutorialStarted)}</strong> finished.
        </p>
      </Section>

      {report.sources.length > 0 && (
        <Section
          title="Where visitors come from"
          note="Links tagged with ?ref=name (for example hexxar.io/?ref=cool-games-list), other sites that linked here, and everyone else. A visitor counts under each source they came by."
        >
          <table className="admin-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Visitors</th>
                <th>Finished tutorial</th>
                <th>Pressed quickplay</th>
                <th>Played a match</th>
              </tr>
            </thead>
            <tbody>
              {report.sources.map((row) => (
                <tr key={`${row.kind}-${row.source}`}>
                  <td>
                    {row.kind === 'direct' ? 'Direct or unknown' : row.source}
                    {row.kind === 'link' && <span className="muted"> (link)</span>}
                    {row.kind === 'site' && <span className="muted"> (site)</span>}
                  </td>
                  <td>{row.visitors}</td>
                  <td>{pct(row.tutorialCompleted, row.visitors)}</td>
                  <td>{pct(row.quickplayed, row.visitors)}</td>
                  <td>{pct(row.playedMatch, row.visitors)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <Section title="Per day">
        <div className="an-dailies">
          <Daily title="Visitors" days={report.daily} pick={(day) => day.visitors} />
          <Daily title="Matches" days={report.daily} pick={(day) => day.matches} />
        </div>
      </Section>

      {report.tutorial.length > 0 && (
        <Section
          title="Tutorial pages"
          note="Page loads that got to each page, and how many quit or retried there."
        >
          <table className="admin-table">
            <thead>
              <tr>
                <th>Lesson</th>
                <th>Page</th>
                <th>Reached</th>
                <th>Quit here</th>
                <th>Quit rate</th>
                <th>Retries</th>
              </tr>
            </thead>
            <tbody>
              {report.tutorial.map((row) => (
                <tr key={`${row.lesson}-${row.step}`}>
                  <td>{LESSONS[row.lesson]?.title ?? row.lesson + 1}</td>
                  <td>{row.step + 1}</td>
                  <td>{row.reached}</td>
                  <td>{row.exits}</td>
                  <td>{pct(row.exits, row.reached)}</td>
                  <td>{row.retries}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {report.lobbies.length > 0 && (
        <Section
          title="Lobbies"
          note="Joins from the last ten minutes are left out of 'played': those lobbies may still be filling."
        >
          <table className="admin-table">
            <thead>
              <tr>
                <th>Kind</th>
                <th>Joined</th>
                <th>Went on to play</th>
                <th>Never played</th>
                <th>Left lobby</th>
                <th>Waited before leaving</th>
              </tr>
            </thead>
            <tbody>
              {report.lobbies.map((row) => (
                <tr key={`${row.visibility}/${row.mode}`}>
                  <td>{kindLabel(row.visibility, row.mode)}</td>
                  <td>{row.joins}</td>
                  <td>
                    {row.played} <span className="muted">{pct(row.played, row.joins)}</span>
                  </td>
                  <td>
                    {row.joins - row.played}{' '}
                    <span className="muted">{pct(row.joins - row.played, row.joins)}</span>
                  </td>
                  <td>{row.leaves}</td>
                  <td>{time(row.avgWaitBeforeLeavingMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {report.starts.length > 0 && (
        <Section
          title="How matches start"
          note="'Short of players' is the time a lobby had too few players to start."
        >
          <table className="admin-table">
            <thead>
              <tr>
                <th>Kind</th>
                <th>Matches</th>
                <th>Players</th>
                <th>Lobby open</th>
                <th>Short of players</th>
                <th>Started because</th>
              </tr>
            </thead>
            <tbody>
              {report.starts.map((row) => (
                <tr key={`${row.visibility}/${row.mode}`}>
                  <td>{kindLabel(row.visibility, row.mode)}</td>
                  <td>{row.matches}</td>
                  <td>{number(row.avgPlayers)}</td>
                  <td>{time(row.avgLobbyMs)}</td>
                  <td>{time(row.avgBelowMinMs)}</td>
                  <td>{counts(row.reasons)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {report.matches.length > 0 && (
        <Section title="How matches go" note="Match length is from the first tick to the end.">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Kind</th>
                <th>Matches</th>
                <th>Average length</th>
                <th>Ended by</th>
                <th>Players' results</th>
              </tr>
            </thead>
            <tbody>
              {report.matches.map((row) => (
                <tr key={`${row.visibility}/${row.mode}`}>
                  <td>{kindLabel(row.visibility, row.mode)}</td>
                  <td>{row.matches}</td>
                  <td>{time(row.avgDurationMs)}</td>
                  <td>{counts(row.endedBy)}</td>
                  <td>{counts(row.outcomes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <Section
        title="Chat"
        note="Visitors who were in a lobby or watching a match, so could have chatted."
      >
        <div className="an-bars">
          <Bar label="Sent a message" value={chat.chatted} of={chat.eligible} />
          <Bar label="Sent none" value={chat.eligible - chat.chatted} of={chat.eligible} />
        </div>
        <p className="an-line">
          {chat.messages} messages in all ({counts(chat.byChannel)}).
        </p>
      </Section>

      <Section
        title="Watching"
        note="What people chose once they were out of a match or it was over."
      >
        {spectating.choices.length === 0 && spectating.watching.length === 0 ? (
          <p className="muted">Nothing yet.</p>
        ) : (
          <>
            {spectating.choices.length > 0 && (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Card</th>
                    <th>Chose</th>
                    <th>Times</th>
                  </tr>
                </thead>
                <tbody>
                  {spectating.choices.map((row) => (
                    <tr key={`${row.card}/${row.choice}`}>
                      <td>{row.card}</td>
                      <td>{row.choice.replaceAll('_', ' ')}</td>
                      <td>{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {spectating.watching.length > 0 && (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Watched as</th>
                    <th>Times</th>
                    <th>Average time</th>
                    <th>Until the end</th>
                  </tr>
                </thead>
                <tbody>
                  {spectating.watching.map((row) => (
                    <tr key={row.role}>
                      <td>{row.role === 'out' ? 'knocked out' : 'spectator'}</td>
                      <td>{row.count}</td>
                      <td>{time(row.avgMs)}</td>
                      <td>
                        {row.untilEnd} <span className="muted">{pct(row.untilEnd, row.count)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="an-line">Spectators who joined: {counts(spectating.joins)}.</p>
          </>
        )}
      </Section>

      <Section title="Other use">
        {Object.keys(usage).length === 0 ? (
          <p className="muted">Nothing yet.</p>
        ) : (
          <p className="an-line">{counts(usage).replaceAll(':', ' · ')}</p>
        )}
      </Section>
    </>
  );
}
