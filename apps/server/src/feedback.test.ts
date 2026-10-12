import { describe, expect, it, vi } from 'vitest';
import { createFeedbackSender, feedbackEmail, RateLimiter } from './feedback.js';

const config = { apiKey: 're_test', to: 'me@example.com', from: 'Hexxar <feedback@example.com>' };

describe('feedback email', () => {
  it('puts the type, the sender and the message in it, and replies go to the sender', () => {
    const email = feedbackEmail(
      config,
      {
        kind: 'bug',
        message: 'The board\nfroze after a tick',
        email: 'a@b.co',
        name: 'Ann',
        details: 'Chrome',
      },
      new Date('2026-01-02T03:04:05Z'),
    );
    expect(email).toMatchObject({
      from: config.from,
      to: ['me@example.com'],
      reply_to: 'a@b.co',
      subject: '[Hexxar] Bug report: The board froze after a tick',
    });
    expect(email.text).toContain('Bug report from Ann · a@b.co');
    expect(email.text).toContain('The board\nfroze after a tick');
    expect(email.text).toContain('Chrome');
    expect(email.text).toContain('2026-01-02T03:04:05.000Z');
  });

  it('works without an address or details', () => {
    const email = feedbackEmail(config, { kind: 'feedback', message: 'Love it' });
    expect(email).not.toHaveProperty('reply_to');
    expect(email.text).toContain('Feedback from anonymous');
  });
});

describe('feedback sender', () => {
  it('posts the email to Resend with the key', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"id":"1"}', { status: 200 }));
    await createFeedbackSender(
      config,
      fetchImpl as unknown as typeof fetch,
    )({
      kind: 'feedback',
      message: 'Hello there',
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_test');
    expect(JSON.parse(init.body as string).to).toEqual(['me@example.com']);
  });

  it('throws when Resend refuses', async () => {
    const fetchImpl = async () => new Response('bad key', { status: 401 });
    await expect(
      createFeedbackSender(
        config,
        fetchImpl as unknown as typeof fetch,
      )({
        kind: 'feedback',
        message: 'Hello there',
      }),
    ).rejects.toThrow(/401/);
  });
});

describe('rate limiter', () => {
  it('lets a caller do so many things in a window, then lets them again once it passes', () => {
    const limiter = new RateLimiter(2, 1000);
    expect(limiter.allow('a', 0)).toBe(true);
    expect(limiter.allow('a', 100)).toBe(true);
    expect(limiter.allow('a', 200)).toBe(false);
    expect(limiter.allow('b', 200)).toBe(true);
    expect(limiter.allow('a', 1100)).toBe(true);
  });
});
