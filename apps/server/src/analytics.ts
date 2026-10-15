import type { EventName, EventProps } from '@hexxar/shared';
import type { Db } from './db.js';

/** Something that happened, and to whom. */
export interface AnalyticsEvent {
  readonly visitorId: string;
  readonly sessionId: string;
  readonly name: EventName;
  readonly props?: EventProps;
  /** When it happened, if that is not now. */
  readonly at?: Date;
}

/** Where the game reports what happens. Recording is fire-and-forget: it never waits and never throws. */
export interface Analytics {
  record(event: AnalyticsEvent): void;
}

/** What is used when there is no database: events go nowhere. */
export const noAnalytics: Analytics = { record: () => undefined };

interface Pending {
  readonly at: Date;
  readonly event: AnalyticsEvent;
  internal: boolean;
}

export interface RecorderOptions {
  /** How often what has been recorded is written out. */
  readonly flushMs?: number;
  /** Written out at once when this many are waiting. */
  readonly batchSize?: number;
  /** When the database cannot keep up (or is down), the oldest are dropped beyond this many. */
  readonly maxPending?: number;
}

/**
 * Collects events in memory and writes them to the `events` table in batches, so recording one never
 * slows the game down, and a database that is down costs some events and nothing else.
 */
export class EventRecorder implements Analytics {
  private pending: Pending[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private writing: Promise<void> = Promise.resolve();
  private dropped = 0;
  private readonly flushMs: number;
  private readonly batchSize: number;
  private readonly maxPending: number;
  /** Visitors whose events are marked internal, so the numbers can leave them out. */
  private readonly internal = new Set<string>();

  constructor(
    private readonly db: Db,
    options: RecorderOptions = {},
  ) {
    this.flushMs = options.flushMs ?? 2000;
    this.batchSize = options.batchSize ?? 200;
    this.maxPending = options.maxPending ?? 5000;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), this.flushMs);
    // A flush timer alone must not keep the process alive.
    this.timer.unref();
  }

  /** Stop the timer and write what is left. */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }

  /** Events from this visitor, from now on and those still waiting to be written, are (or are not) internal. */
  markInternal(visitorId: string, internal: boolean): void {
    if (internal) this.internal.add(visitorId);
    else this.internal.delete(visitorId);
    for (const waiting of this.pending) {
      if (waiting.event.visitorId === visitorId) waiting.internal = internal;
    }
  }

  isInternal(visitorId: string): boolean {
    return this.internal.has(visitorId);
  }

  /** Remember the browsers marked as the owner's in earlier runs. */
  async loadInternal(): Promise<void> {
    const { rows } = await this.db.query<{ visitor_id: string }>(
      'SELECT visitor_id FROM internal_visitors',
    );
    for (const row of rows) this.internal.add(row.visitor_id);
  }

  /**
   * Mark a browser as the owner's (or not), for good: what it did before is changed too, so the
   * reports leave it out (or put it back) however far back they look.
   */
  async setInternal(visitorId: string, internal: boolean): Promise<void> {
    this.markInternal(visitorId, internal);
    // What is waiting is written first, so the update below reaches it too.
    await this.flush();
    if (internal) {
      await this.db.query(
        'INSERT INTO internal_visitors (visitor_id) VALUES ($1) ON CONFLICT DO NOTHING',
        [visitorId],
      );
    } else {
      await this.db.query('DELETE FROM internal_visitors WHERE visitor_id = $1', [visitorId]);
    }
    await this.db.query(
      'UPDATE events SET internal = $2 WHERE visitor_id = $1 AND internal <> $2',
      [visitorId, internal],
    );
  }

  record(event: AnalyticsEvent): void {
    this.pending.push({
      at: event.at ?? new Date(),
      event,
      internal: this.internal.has(event.visitorId),
    });
    if (this.pending.length > this.maxPending) {
      const extra = this.pending.length - this.maxPending;
      this.pending.splice(0, extra);
      this.dropped += extra;
    }
    if (this.pending.length >= this.batchSize) void this.flush();
  }

  /** Write everything waiting. Batches go out one after another; a failed one is dropped, not retried. */
  flush(): Promise<void> {
    const batch = this.pending;
    this.pending = [];
    if (batch.length === 0) return this.writing;
    const run = async (): Promise<void> => {
      try {
        await this.db.query(
          `INSERT INTO events (at, visitor_id, session_id, name, props, internal)
           SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::text[], $4::text[], $5::jsonb[], $6::boolean[])`,
          [
            batch.map((p) => p.at),
            batch.map((p) => p.event.visitorId),
            batch.map((p) => p.event.sessionId),
            batch.map((p) => p.event.name),
            batch.map((p) => JSON.stringify(p.event.props ?? {})),
            batch.map((p) => p.internal),
          ],
        );
        if (this.dropped > 0) {
          console.warn(
            `analytics: ${this.dropped} events were dropped while the database was slow`,
          );
          this.dropped = 0;
        }
      } catch (error) {
        this.dropped += batch.length;
        console.error(`analytics: could not save ${batch.length} events`, error);
      }
    };
    this.writing = this.writing.then(run, run);
    return this.writing;
  }
}
