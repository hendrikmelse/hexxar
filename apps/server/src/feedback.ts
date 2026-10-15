import type { StoredFeedback } from '@hexxar/shared';
import type { FeedbackStore } from './feedbackStore.js';

/** How the daily email is sent (through Resend). */
export interface MailConfig {
  /** The Resend API key. */
  readonly apiKey: string;
  /** Who gets the email. */
  readonly to: string;
  /** The sender shown on it. Must be an address Resend is allowed to send from. */
  readonly from: string;
  /** Resend's address for sending email: only different when trying this out against a stand-in. */
  readonly endpoint?: string;
}

export type Fetch = typeof fetch;

/** An email, in the shape Resend takes. */
export interface Mail {
  readonly subject: string;
  readonly text: string;
}

/** A function that sends an email through Resend. It throws if Resend refuses. `fetchImpl` is for tests. */
export function createMailer(config: MailConfig, fetchImpl: Fetch = fetch) {
  return async (mail: Mail): Promise<void> => {
    const response = await fetchImpl(config.endpoint ?? 'https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: config.from, to: [config.to], ...mail }),
    });
    if (!response.ok) {
      throw new Error(
        `Resend answered ${response.status}: ${(await response.text()).slice(0, 300)}`,
      );
    }
  };
}

const LABELS = { feedback: 'Feedback', bug: 'Bug report' } as const;

/** The longest a message is quoted in the daily email; the rest is in the admin panel. */
const QUOTE_MAX = 600;

/** The daily email listing everything that is still open, oldest first. */
export function digestEmail(open: readonly StoredFeedback[], adminUrl: string): Mail {
  const bugs = open.filter((item) => item.kind === 'bug').length;
  const count = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
  const summary =
    bugs > 0
      ? `${count(open.length, 'unresolved item')} (${count(bugs, 'bug report')})`
      : count(open.length, 'unresolved item');
  const entries = open.map((item) => {
    const who = [item.name, item.email].filter(Boolean).join(' · ') || 'anonymous';
    const message =
      item.message.length > QUOTE_MAX ? `${item.message.slice(0, QUOTE_MAX)}...` : item.message;
    return `${LABELS[item.kind]} from ${who}, ${item.receivedAt.slice(0, 16).replace('T', ' ')} UTC\n${message}`;
  });
  return {
    subject: `[Hexxar] ${summary} waiting`,
    text: [
      `${summary} in the feedback hub:`,
      '',
      entries.join('\n\n---\n\n'),
      '',
      `Open the hub: ${adminUrl}`,
    ].join('\n'),
  };
}

/** The date (YYYY-MM-DD) and minutes since midnight on the clock in `timeZone` at `now`. */
export function localClock(now: Date, timeZone: string): { date: string; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export interface DigestOptions {
  readonly store: FeedbackStore;
  readonly mail: (mail: Mail) => Promise<void>;
  /** The hour of the day (0-23, on the clock in `timeZone`) the email goes out. */
  readonly hour: number;
  readonly timeZone: string;
  /** Where the admin panel is, for the link in the email. */
  readonly adminUrl: string;
}

/**
 * How long after the hour a missed email is still sent (the server was restarting at the time, or
 * Resend was down). Later than that it waits for tomorrow rather than turning up at a random time.
 */
const CATCH_UP_MINUTES = 3 * 60;

/**
 * The daily email: at `hour` it sends everything unresolved, or nothing at all if there is
 * nothing. Each day is dealt with once (remembered in the store, so a restart does not repeat it),
 * and a failed send is tried again a minute later, until the catch-up window is over.
 */
export function createDigest(options: DigestOptions) {
  let running = false;
  const check = async (now = new Date()): Promise<boolean> => {
    const clock = localClock(now, options.timeZone);
    const late = clock.minutes - options.hour * 60;
    if (late < 0 || late >= CATCH_UP_MINUTES) return false;
    if (running) return false;
    running = true;
    try {
      if ((await options.store.lastDigest()) === clock.date) return false;
      const open = await options.store.open();
      if (open.length > 0) await options.mail(digestEmail(open, options.adminUrl));
      await options.store.setLastDigest(clock.date);
      return open.length > 0;
    } finally {
      running = false;
    }
  };
  return {
    check,
    /** Look every minute. Returns a function that stops it. */
    start(): () => void {
      const id = setInterval(() => {
        check().catch((error) => console.error('daily feedback email failed', error));
      }, 60_000);
      return () => clearInterval(id);
    },
  };
}

/** Lets each caller (an IP address) do a few things in a window of time, to keep the form from being flooded. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Has `key` used up its allowance? (Counts nothing.) */
  over(key: string, now = Date.now()): boolean {
    return (this.hits.get(key) ?? []).filter((at) => now - at < this.windowMs).length >= this.max;
  }

  /** Count a hit for `key`: true if it is allowed, false if the key is over the limit. */
  allow(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((at) => now - at < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    // Forget callers who have gone quiet, so the map does not grow for ever.
    if (this.hits.size > 1000) {
      for (const [other, times] of this.hits) {
        if (times.every((at) => now - at >= this.windowMs)) this.hits.delete(other);
      }
    }
    return true;
  }
}
