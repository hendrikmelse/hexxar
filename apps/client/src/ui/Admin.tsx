import { useCallback, useEffect, useState } from 'react';
import type { AdminStats, StoredFeedback } from '@hexxar/shared';
import { serverHttpUrl } from '../serverUrl.js';
import { Segmented } from './Lobby.js';

/** The admin panel, at `/?admin`. The password is kept for the tab only. */
const PASSWORD_KEY = 'hexxar-admin';

class Unauthorized extends Error {}

/** Call the admin API with the password; throws `Unauthorized` if it is wrong. */
async function api<T>(password: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(serverHttpUrl(`/api/admin${path}`), {
    ...init,
    headers: { Authorization: `Bearer ${encodeURIComponent(password)}` },
  });
  if (response.status === 401) throw new Unauthorized();
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !body)
    throw new Error(body?.error ?? `The server answered ${response.status}`);
  return body;
}

export function Admin() {
  const [password, setPassword] = useState(() => sessionStorage.getItem(PASSWORD_KEY) ?? '');
  const [signedIn, setSignedIn] = useState(false);

  const signOut = useCallback((): void => {
    sessionStorage.removeItem(PASSWORD_KEY);
    setPassword('');
    setSignedIn(false);
  }, []);

  return (
    <div className="screen">
      {signedIn ? (
        <Dashboard password={password} onSignOut={signOut} />
      ) : (
        <Login
          initial={password}
          onSignedIn={(value) => {
            sessionStorage.setItem(PASSWORD_KEY, value);
            setPassword(value);
            setSignedIn(true);
          }}
        />
      )}
    </div>
  );
}

function Login({
  initial,
  onSignedIn,
}: {
  initial: string;
  onSignedIn: (password: string) => void;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const attempt = useCallback(
    async (password: string): Promise<void> => {
      setChecking(true);
      setError(null);
      try {
        await api<AdminStats>(password, '/stats');
        onSignedIn(password);
      } catch (cause) {
        setError(cause instanceof Unauthorized ? 'That password is not right.' : String(cause));
        setChecking(false);
      }
    },
    [onSignedIn],
  );

  // Back in the same tab: the saved password is tried again.
  useEffect(() => {
    if (initial) void attempt(initial);
  }, []);

  return (
    <form
      className="card gate"
      onSubmit={(event) => {
        event.preventDefault();
        if (value && !checking) void attempt(value);
      }}
    >
      <h2 className="center">Admin</h2>
      <input
        type="password"
        aria-label="Admin password"
        placeholder="Password"
        autoComplete="off"
        autoFocus
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      {error && (
        <p className="error center" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="primary" disabled={!value || checking}>
        {checking ? 'Checking...' : 'Enter'}
      </button>
    </form>
  );
}

type Tab = 'overview' | 'feedback';

function Dashboard({ password, onSignOut }: { password: string; onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setStats(await api<AdminStats>(password, '/stats'));
      setError(null);
    } catch (cause) {
      if (cause instanceof Unauthorized) onSignOut();
      else setError('Could not reach the server.');
    }
  }, [password, onSignOut]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 3000);
    return () => clearInterval(id);
  }, [refresh]);

  const open = stats?.feedback.open ?? 0;
  return (
    <div className="card admin">
      <header className="admin-head">
        <h2>Hexxar admin</h2>
        <div className="admin-head-actions">
          <a href="/">Back to the game</a>
          <button onClick={onSignOut}>Sign out</button>
        </div>
      </header>

      <Segmented
        label="Section"
        value={tab}
        options={[
          { value: 'overview', label: 'Overview' },
          { value: 'feedback', label: open > 0 ? `Feedback (${open})` : 'Feedback' },
        ]}
        onChange={setTab}
      />

      {error && (
        <p className="feedback-error" role="alert">
          {error}
        </p>
      )}
      {tab === 'overview' ? (
        <Overview stats={stats} />
      ) : (
        <FeedbackHub password={password} onChanged={() => void refresh()} />
      )}
    </div>
  );
}

const duration = (ms: number): string => {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
};

function Overview({ stats }: { stats: AdminStats | null }) {
  if (!stats) return <p className="muted center">Loading...</p>;
  const inGames = stats.connected - stats.inMenu;
  const tiles: [string, string | number][] = [
    ['Online', stats.connected],
    ['In the menu', stats.inMenu],
    ['In games', inGames],
    ['Public duels', stats.publicPlayers.duel],
    ['Public royales', stats.publicPlayers.ffa],
    ['Open feedback', stats.feedback.open],
    ['Uptime', duration(stats.serverTime - stats.startedAt)],
  ];
  return (
    <>
      <div className="admin-tiles">
        {tiles.map(([label, value]) => (
          <div key={label} className="admin-tile">
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>

      <h3 className="admin-sub">Games ({stats.rooms.length})</h3>
      {stats.rooms.length === 0 ? (
        <p className="muted center">No games open right now.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Mode</th>
              <th>Type</th>
              <th>State</th>
              <th>Players</th>
              <th>Watching</th>
              <th>Age</th>
              <th>Who</th>
            </tr>
          </thead>
          <tbody>
            {stats.rooms.map((room) => (
              <tr key={room.code}>
                <td>
                  <code>{room.code}</code>
                </td>
                <td>{room.mode === 'ffa' ? 'Royale' : 'Duel'}</td>
                <td>{room.visibility}</td>
                <td>{room.state}</td>
                <td>{room.players}</td>
                <td>{room.spectators}</td>
                <td>{duration(stats.serverTime - room.createdAt)}</td>
                <td>{room.names.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

type Filter = 'open' | 'resolved' | 'all';

const when = (iso: string): string => new Date(iso).toLocaleString();

function FeedbackHub({ password, onChanged }: { password: string; onChanged: () => void }) {
  const [items, setItems] = useState<StoredFeedback[] | null>(null);
  const [filter, setFilter] = useState<Filter>('open');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setItems((await api<{ feedback: StoredFeedback[] }>(password, '/feedback')).feedback);
      setError(null);
    } catch {
      setError('Could not load the feedback.');
    }
  }, [password]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 15_000);
    return () => clearInterval(id);
  }, [load]);

  const change = async (path: string, init: RequestInit): Promise<void> => {
    try {
      await api(password, path, init);
      await load();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const shown = (items ?? []).filter(
    (item) => filter === 'all' || (filter === 'open') === (item.resolvedAt === null),
  );
  return (
    <>
      <Segmented
        label="Show"
        value={filter}
        options={[
          { value: 'open', label: 'Open' },
          { value: 'resolved', label: 'Resolved' },
          { value: 'all', label: 'All' },
        ]}
        onChange={setFilter}
      />
      {error && (
        <p className="feedback-error" role="alert">
          {error}
        </p>
      )}
      {items && shown.length === 0 && (
        <p className="muted center">
          {filter === 'open' ? 'Nothing waiting. 🎉' : 'Nothing here.'}
        </p>
      )}
      <div className="admin-feedback">
        {shown.map((item) => (
          <article key={item.id} className={`admin-item${item.resolvedAt ? ' resolved' : ''}`}>
            <header>
              <span className={`admin-kind ${item.kind}`}>
                {item.kind === 'bug' ? 'Bug report' : 'Feedback'}
              </span>
              <span className="muted">{when(item.receivedAt)}</span>
            </header>
            <p className="admin-who">
              {item.name ?? 'anonymous'}
              {item.email && (
                <>
                  {' · '}
                  <a href={`mailto:${item.email}`}>{item.email}</a>
                </>
              )}
            </p>
            <p className="admin-message">{item.message}</p>
            {item.details && (
              <details>
                <summary>Technical details</summary>
                <pre>{item.details}</pre>
              </details>
            )}
            <div className="admin-item-actions">
              <button
                className={item.resolvedAt ? undefined : 'primary'}
                onClick={() =>
                  void change(`/feedback/${item.id}`, {
                    method: 'POST',
                    body: JSON.stringify({ resolved: item.resolvedAt === null }),
                  })
                }
              >
                {item.resolvedAt ? 'Reopen' : 'Resolve'}
              </button>
              <button
                onClick={() => {
                  if (confirm('Delete this for good?'))
                    void change(`/feedback/${item.id}`, { method: 'DELETE' });
                }}
              >
                Delete
              </button>
              {item.resolvedAt && <span className="muted">Resolved {when(item.resolvedAt)}</span>}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
