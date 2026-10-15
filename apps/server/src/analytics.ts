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
  readonly internal: boolean;
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

  markInternal(visitorId: string, internal: boolean): void {
    if (internal) this.internal.add(visitorId);
    else this.internal.delete(visitorId);
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
