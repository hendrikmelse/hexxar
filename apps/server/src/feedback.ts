import type { Feedback } from '@hexxar/shared';

/** Where feedback goes, and how it is sent (through Resend). */
export interface FeedbackConfig {
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

const SUBJECTS = { feedback: 'Feedback', bug: 'Bug report' } as const;

/** A subject on one line, and not too long. */
const oneLine = (text: string, max: number): string =>
  text.replace(/\s+/g, ' ').trim().slice(0, max);

/** The email for a submission, as the body of a request to Resend. */
export function feedbackEmail(config: FeedbackConfig, feedback: Feedback, now = new Date()) {
  const label = SUBJECTS[feedback.kind];
  const who = [feedback.name, feedback.email].filter(Boolean).join(' · ') || 'anonymous';
  const text = [
    `${label} from ${who}`,
    '',
    feedback.message,
    '',
    feedback.details ? `---\nDetails:\n${feedback.details}\n` : '',
    `Sent ${now.toISOString()}`,
  ]
    .filter((part, index, parts) => part !== '' || parts[index - 1] !== '')
    .join('\n');
  return {
    from: config.from,
    to: [config.to],
    subject: `[Hexxar] ${label}: ${oneLine(feedback.message, 60)}`,
    text,
    // Replying to the email answers the sender, when they left an address.
    ...(feedback.email ? { reply_to: feedback.email } : {}),
  };
}

/**
 * A function that emails a submission through Resend. It throws if Resend refuses, so the page can
 * tell the sender it did not go. `fetchImpl` is for tests.
 */
export function createFeedbackSender(config: FeedbackConfig, fetchImpl: Fetch = fetch) {
  return async (feedback: Feedback): Promise<void> => {
    const response = await fetchImpl(config.endpoint ?? 'https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(feedbackEmail(config, feedback)),
    });
    if (!response.ok) {
      throw new Error(
        `Resend answered ${response.status}: ${(await response.text()).slice(0, 300)}`,
      );
    }
  };
}

/** Lets each caller (an IP address) do a few things in a window of time, to keep the form from being flooded. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

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
