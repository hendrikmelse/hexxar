import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDigest, createMailer, digestEmail, localClock, RateLimiter } from './feedback.js';
import { FeedbackStore } from './feedbackStore.js';

const config = { apiKey: 're_test', to: 'me@example.com', from: 'Hexxar <feedback@example.com>' };

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hexxar-feedback-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('feedback store', () => {
  it('keeps what it is given across a restart, newest first', async () => {
    const store = new FeedbackStore(dir);
    await store.add(
      { kind: 'bug', message: 'first', name: 'Ann' },
      new Date('2026-01-01T00:00:00Z'),
    );
    await store.add({ kind: 'feedback', message: 'second', email: 'a@b.co' });
    const again = new FeedbackStore(dir);
    expect(again.list().map((item) => item.message)).toEqual(['second', 'first']);
    expect(again.list()[1]).toMatchObject({ kind: 'bug', name: 'Ann', resolvedAt: null });
    expect(again.list()[0]).not.toHaveProperty('name');
  });

  it('marks items resolved and open again, and deletes them', async () => {
    const store = new FeedbackStore(dir);
    const a = await store.add({ kind: 'bug', message: 'one' });
    await store.add({ kind: 'bug', message: 'two' });
    expect(await store.setResolved(a.id, true)).toBe(true);
    expect(store.open().map((item) => item.message)).toEqual(['two']);
    await store.setResolved(a.id, false);
    expect(store.open()).toHaveLength(2);
    expect(await store.remove(a.id)).toBe(true);
    expect(await store.remove(a.id)).toBe(false);
    expect(await store.setResolved('nope', true)).toBe(false);
    expect(new FeedbackStore(dir).total).toBe(1);
  });

  it('refuses to start over a damaged file', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'feedback.json'), '{broken');
    expect(() => new FeedbackStore(dir)).toThrow();
  });
});

describe('mailer', () => {
  it('posts the email to Resend with the key', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"id":"1"}', { status: 200 }));
    await createMailer(config, fetchImpl as unknown as typeof fetch)({ subject: 'S', text: 'T' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_test');
    expect(JSON.parse(init.body as string)).toEqual({
      from: config.from,
      to: ['me@example.com'],
      subject: 'S',
      text: 'T',
    });
  });

  it('throws when Resend refuses', async () => {
    const fetchImpl = async () => new Response('bad key', { status: 401 });
    await expect(
      createMailer(config, fetchImpl as unknown as typeof fetch)({ subject: 'S', text: 'T' }),
    ).rejects.toThrow(/401/);
  });
});

describe('daily email', () => {
  it('lists every open item and links to the hub', () => {
    const mail = digestEmail(
      [
        {
          id: '1',
          receivedAt: '2026-01-02T03:04:05.000Z',
          kind: 'bug',
          message: 'The board froze',
          name: 'Ann',
          email: 'a@b.co',
          resolvedAt: null,
        },
        {
          id: '2',
          receivedAt: '2026-01-03T10:00:00.000Z',
          kind: 'feedback',
          message: 'Love it',
          resolvedAt: null,
        },
      ],
      'https://hexxar.io/?admin',
    );
    expect(mail.subject).toBe('[Hexxar] 2 unresolved items (1 bug report) waiting');
    expect(mail.text).toContain('Bug report from Ann · a@b.co, 2026-01-02 03:04 UTC');
    expect(mail.text).toContain('Feedback from anonymous');
    expect(mail.text).toContain('https://hexxar.io/?admin');
  });

  it('reads the clock in the given time zone', () => {
    // 05:30 UTC is 07:30 in Amsterdam in summer, and 06:30 in winter.
    expect(localClock(new Date('2026-07-01T05:30:00Z'), 'Europe/Amsterdam')).toEqual({
      date: '2026-07-01',
      minutes: 7 * 60 + 30,
    });
    expect(localClock(new Date('2026-12-01T05:30:00Z'), 'Europe/Amsterdam').minutes).toBe(
      6 * 60 + 30,
    );
    expect(localClock(new Date('2026-07-01T23:30:00Z'), 'Europe/Amsterdam').date).toBe(
      '2026-07-02',
    );
  });

  const setup = async (open: number) => {
    const store = new FeedbackStore(dir);
    for (let i = 0; i < open; i++) await store.add({ kind: 'feedback', message: `message ${i}` });
    const mail = vi.fn(async () => undefined);
    const digest = createDigest({
      store,
      mail,
      hour: 7,
      timeZone: 'Europe/Amsterdam',
      adminUrl: 'https://x/?admin',
    });
    return { store, mail, digest };
  };
  // 07:00 in Amsterdam on 1 July.
  const sevenAm = new Date('2026-07-01T05:00:00Z');

  it('sends at 7am when something is unresolved, and only once that day', async () => {
    const { mail, digest } = await setup(2);
    expect(await digest.check(new Date('2026-07-01T04:59:00Z'))).toBe(false);
    expect(await digest.check(sevenAm)).toBe(true);
    expect(await digest.check(new Date('2026-07-01T05:01:00Z'))).toBe(false);
    expect(mail).toHaveBeenCalledTimes(1);
    expect(await digest.check(new Date('2026-07-02T05:00:00Z'))).toBe(true);
    expect(mail).toHaveBeenCalledTimes(2);
  });

  it('sends nothing when everything is resolved, and does not catch up later in the day', async () => {
    const { store, mail, digest } = await setup(1);
    await store.setResolved(store.open()[0]!.id, true);
    expect(await digest.check(sevenAm)).toBe(false);
    await store.add({ kind: 'bug', message: 'arrived after seven' });
    expect(await digest.check(new Date('2026-07-01T05:30:00Z'))).toBe(false);
    expect(mail).not.toHaveBeenCalled();
  });

  it('remembers the day across a restart, and retries a failed send', async () => {
    const { store, mail, digest } = await setup(1);
    mail.mockRejectedValueOnce(new Error('down'));
    await expect(digest.check(sevenAm)).rejects.toThrow('down');
    expect(await digest.check(new Date('2026-07-01T05:01:00Z'))).toBe(true);
    const restarted = createDigest({
      store: new FeedbackStore(dir),
      mail,
      hour: 7,
      timeZone: 'Europe/Amsterdam',
      adminUrl: 'x',
    });
    expect(await restarted.check(new Date('2026-07-01T05:02:00Z'))).toBe(false);
    expect(store.lastDigest).toBe('2026-07-01');
  });

  it('gives up on a missed email after the catch-up window', async () => {
    const { mail, digest } = await setup(1);
    expect(await digest.check(new Date('2026-07-01T09:00:00Z'))).toBe(false); // 11:00 local
    expect(mail).not.toHaveBeenCalled();
  });
});

describe('rate limiter', () => {
  it('lets a caller do so many things in a window, then lets them again once it passes', () => {
    const limiter = new RateLimiter(2, 1000);
    expect(limiter.allow('a', 0)).toBe(true);
    expect(limiter.allow('a', 100)).toBe(true);
    expect(limiter.over('a', 150)).toBe(true);
    expect(limiter.allow('a', 200)).toBe(false);
    expect(limiter.allow('b', 200)).toBe(true);
    expect(limiter.over('a', 1100)).toBe(false);
    expect(limiter.allow('a', 1100)).toBe(true);
  });
});
