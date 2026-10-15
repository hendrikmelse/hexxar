import pg from 'pg';

export type Db = pg.Pool;

/**
 * The database's tables, as numbered steps. A step that has run is never run again, so a change to
 * the tables is a new step added at the end; the ones before it are never edited.
 */
const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE feedback (
    id          uuid PRIMARY KEY,
    received_at timestamptz NOT NULL,
    kind        text NOT NULL CHECK (kind IN ('feedback', 'bug')),
    message     text NOT NULL,
    email       text,
    name        text,
    details     text,
    resolved_at timestamptz
  );
  CREATE INDEX feedback_received ON feedback (received_at);

  -- Small things the server remembers between runs (such as the day the daily email last went out).
  CREATE TABLE meta (
    key   text PRIMARY KEY,
    value text NOT NULL
  );

  -- Everything analytics measures: one row per thing that happened. A visitor is a browser (an id the
  -- page makes up and keeps), a session is one page load. "internal" marks the site owner's own
  -- activity so the numbers can leave it out. Nothing here can identify a person: no IP, no text.
  CREATE TABLE events (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    at         timestamptz NOT NULL,
    visitor_id text NOT NULL,
    session_id text NOT NULL,
    name       text NOT NULL,
    props      jsonb NOT NULL DEFAULT '{}',
    internal   boolean NOT NULL DEFAULT false
  );
  CREATE INDEX events_name_at ON events (name, at);
  CREATE INDEX events_visitor_at ON events (visitor_id, at);
  CREATE INDEX events_session ON events (session_id, at);
  `,
  `
  -- Browsers whose activity is the owner's: their events are kept, but marked internal and left out of reports.
  CREATE TABLE internal_visitors (
    visitor_id text PRIMARY KEY,
    added_at   timestamptz NOT NULL DEFAULT now()
  );
  `,
];

/** A key for the lock that keeps two servers starting at once from running the same step twice. */
const MIGRATION_LOCK = 727_274;

/** Opens the pool and brings the tables up to date. */
export async function openDb(url: string, options: pg.PoolConfig = {}): Promise<Db> {
  const pool = new pg.Pool({ connectionString: url, max: 5, ...options });
  // An idle connection dropped by the database must not take the whole server down.
  pool.on('error', (error) => console.error('database connection error', error));
  try {
    await migrate(pool);
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }
  return pool;
}

export async function migrate(pool: Db): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await client.query('CREATE TABLE IF NOT EXISTS migrations (step integer PRIMARY KEY)');
    const done = await client.query<{ step: number }>('SELECT step FROM migrations');
    const have = new Set(done.rows.map((row) => row.step));
    for (const [index, sql] of MIGRATIONS.entries()) {
      const step = index + 1;
      if (have.has(step)) continue;
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO migrations (step) VALUES ($1)', [step]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => undefined);
    client.release();
  }
}
