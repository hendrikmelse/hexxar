import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { openDb, type Db } from './db.js';

/** Where tests find a Postgres: TEST_DATABASE_URL (set in CI), or the one from docker-compose.yml. */
const URL = process.env.TEST_DATABASE_URL ?? 'postgres://hexxar:hexxar@localhost:5433/hexxar';

export interface TestDb {
  readonly db: Db;
  /** Throws the schema away. */
  drop(): Promise<void>;
}

/**
 * A database to test against: a fresh schema (its own copy of the tables) in the test Postgres, so
 * tests never touch real data or each other. Null when there is no Postgres to talk to, and the
 * tests that need one are skipped; if TEST_DATABASE_URL is set that is an error instead.
 */
export async function openTestDb(): Promise<TestDb | null> {
  const schema = `test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Pool({ connectionString: URL, max: 1, connectionTimeoutMillis: 1500 });
  admin.on('error', () => undefined);
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
  } catch (error) {
    await admin.end().catch(() => undefined);
    if (process.env.TEST_DATABASE_URL) throw error;
    return null;
  }
  const db = await openDb(URL, { options: `-c search_path=${schema}` });
  return {
    db,
    drop: async () => {
      await db.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    },
  };
}
