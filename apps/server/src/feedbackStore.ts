import { randomUUID } from 'node:crypto';
import type { Feedback, StoredFeedback } from '@hexxar/shared';
import type { Db } from './db.js';

/** Where feedback and bug reports are kept, and the day the daily email last went out. */
export interface FeedbackStore {
  /** Newest first. */
  list(): Promise<StoredFeedback[]>;
  /** What has not been dealt with, oldest first. */
  open(): Promise<StoredFeedback[]>;
  total(): Promise<number>;
  /** The local date (YYYY-MM-DD) the daily email was last dealt with, so it is not sent twice. */
  lastDigest(): Promise<string | null>;
  add(feedback: Feedback, now?: Date): Promise<StoredFeedback>;
  /** Mark one as dealt with (or open again). False if there is no such item. */
  setResolved(id: string, resolved: boolean, now?: Date): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  setLastDigest(date: string): Promise<void>;
}

interface Row {
  id: string;
  received_at: Date;
  kind: 'feedback' | 'bug';
  message: string;
  email: string | null;
  name: string | null;
  details: string | null;
  resolved_at: Date | null;
}

const toStored = (row: Row): StoredFeedback => ({
  id: row.id,
  receivedAt: row.received_at.toISOString(),
  kind: row.kind,
  message: row.message,
  ...(row.email ? { email: row.email } : {}),
  ...(row.name ? { name: row.name } : {}),
  ...(row.details ? { details: row.details } : {}),
  resolvedAt: row.resolved_at?.toISOString() ?? null,
});

const DIGEST_KEY = 'lastDigest';
// A made-up id that is not a UUID would make Postgres throw, so those are simply "not found".
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Feedback in the `feedback` table. */
export class PgFeedbackStore implements FeedbackStore {
  constructor(private readonly db: Db) {}

  async list(): Promise<StoredFeedback[]> {
    const { rows } = await this.db.query<Row>('SELECT * FROM feedback ORDER BY received_at DESC');
    return rows.map(toStored);
  }

  async open(): Promise<StoredFeedback[]> {
    const { rows } = await this.db.query<Row>(
      'SELECT * FROM feedback WHERE resolved_at IS NULL ORDER BY received_at',
    );
    return rows.map(toStored);
  }

  async total(): Promise<number> {
    const { rows } = await this.db.query<{ n: string }>('SELECT count(*) AS n FROM feedback');
    return Number(rows[0]?.n ?? 0);
  }

  async lastDigest(): Promise<string | null> {
    const { rows } = await this.db.query<{ value: string }>(
      'SELECT value FROM meta WHERE key = $1',
      [DIGEST_KEY],
    );
    return rows[0]?.value ?? null;
  }

  async add(feedback: Feedback, now = new Date()): Promise<StoredFeedback> {
    const { rows } = await this.db.query<Row>(
      `INSERT INTO feedback (id, received_at, kind, message, email, name, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        randomUUID(),
        now,
        feedback.kind,
        feedback.message,
        feedback.email || null,
        feedback.name || null,
        feedback.details || null,
      ],
    );
    return toStored(rows[0]!);
  }

  async setResolved(id: string, resolved: boolean, now = new Date()): Promise<boolean> {
    if (!UUID.test(id)) return false;
    const result = await this.db.query('UPDATE feedback SET resolved_at = $2 WHERE id = $1', [
      id,
      resolved ? now : null,
    ]);
    return result.rowCount === 1;
  }

  async remove(id: string): Promise<boolean> {
    if (!UUID.test(id)) return false;
    const result = await this.db.query('DELETE FROM feedback WHERE id = $1', [id]);
    return result.rowCount === 1;
  }

  async setLastDigest(date: string): Promise<void> {
    await this.db.query(
      `INSERT INTO meta (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [DIGEST_KEY, date],
    );
  }
}

/**
 * Feedback held in memory, lost when the server stops: for development and tests without a
 * database. (Without DATABASE_URL the server runs on this, and says so.)
 */
export class MemoryFeedbackStore implements FeedbackStore {
  private items: StoredFeedback[] = [];
  private digest: string | null = null;

  async list(): Promise<StoredFeedback[]> {
    return [...this.items].reverse();
  }

  async open(): Promise<StoredFeedback[]> {
    return this.items.filter((item) => item.resolvedAt === null);
  }

  async total(): Promise<number> {
    return this.items.length;
  }

  async lastDigest(): Promise<string | null> {
    return this.digest;
  }

  async add(feedback: Feedback, now = new Date()): Promise<StoredFeedback> {
    const item: StoredFeedback = {
      id: randomUUID(),
      receivedAt: now.toISOString(),
      kind: feedback.kind,
      message: feedback.message,
      ...(feedback.email ? { email: feedback.email } : {}),
      ...(feedback.name ? { name: feedback.name } : {}),
      ...(feedback.details ? { details: feedback.details } : {}),
      resolvedAt: null,
    };
    this.items.push(item);
    return item;
  }

  async setResolved(id: string, resolved: boolean, now = new Date()): Promise<boolean> {
    const index = this.items.findIndex((item) => item.id === id);
    const item = this.items[index];
    if (!item) return false;
    this.items[index] = { ...item, resolvedAt: resolved ? now.toISOString() : null };
    return true;
  }

  async remove(id: string): Promise<boolean> {
    const before = this.items.length;
    this.items = this.items.filter((item) => item.id !== id);
    return this.items.length < before;
  }

  async setLastDigest(date: string): Promise<void> {
    this.digest = date;
  }
}
