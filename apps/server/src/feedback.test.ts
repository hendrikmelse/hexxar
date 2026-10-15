import { afterAll, describe, expect, it, vi } from 'vitest';
import { createDigest, createMailer, digestEmail, localClock, RateLimiter } from './feedback.js';
import { MemoryFeedbackStore, PgFeedbackStore, type FeedbackStore } from './feedbackStore.js';
import { openTestDb } from './test-db.js';

const config = { apiKey: 're_test', to: 'me@example.com', from: 'Hexxar <feedback@example.com>' };

const testDb = await openTestDb();
afterAll(() => testDb?.drop());

// The same behaviour is expected of the store kept in memory and the one in Postgres.
const stores: [string, (() => FeedbackStore) | null][] = [
  ['memory', () => new MemoryFeedbackStore()],
  ['postgres', testDb ? () => new PgFeedbackStore(testDb.db) : null],
];

describe.each(stores)('feedback store (%s)', (_name, make) => {
  const it_ = make ? it : it.skip;
  const fresh = async (): Promise<FeedbackStore> => {
    // Postgres tests share a schema, so empty it first.
    await testDb?.db.query('TRUNCATE feedback, meta');
    return make!();
  };

  it_('lists newest first and leaves out what was not given', async () => {
    const store = await fresh();
    await store.add(
      { kind: 'bug', message: 'first', name: 'Ann' },
      new Date('2026-01-01T00:00:00Z'),
    );
    await store.add({ kind: 'feedback', message: 'second', email: 'a@b.co' });
    const list = await store.list();
    expect(list.map((item) => item.message)).toEqual(['second', 'first']);
    expect(list[1]).toMatchObject({ kind: 'bug', name: 'Ann', resolvedAt: null });
    expect(list[0]).not.toHaveProperty('name');
    expect(list[0]).toMatchObject({ email: 'a@b.co' });
  });

  it_('marks items resolved and open again, and deletes them', async () => {
    const store = await fresh();
    const a = await store.add({ kind: 'bug', message: 'one' });
    await store.add({ kind: 'bug', message: 'two' });
    expect(await store.setResolved(a.id, true)).toBe(true);
    expect((await store.open()).map((item) => item.message)).toEqual(['two']);
    await store.setResolved(a.id, false);
    expect(await store.open()).toHaveLength(2);
    expect(await store.remove(a.id)).toBe(true);
    expect(await store.remove(a.id)).toBe(false);
    expect(await store.setResolved('nope', true)).toBe(false);
    expect(await store.remove('nope')).toBe(false);
    expect(await store.total()).toBe(1);
  });

  it_('remembers the day of the last email', async () => {
    const store = await fresh();
    expect(await store.lastDigest()).toBeNull();
    await store.setLastDigest('2026-07-01');
    await store.setLastDigest('2026-07-02');
    expect(await store.lastDigest()).toBe('2026-07-02');
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
    const store = new MemoryFeedbackStore();
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
    await store.setResolved((await store.open())[0]!.id, true);
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
    // A restart keeps the store (it is in the database), so the same one is used again.
    const restarted = createDigest({
      store,
      mail,
      hour: 7,
      timeZone: 'Europe/Amsterdam',
      adminUrl: 'x',
    });
    expect(await restarted.check(new Date('2026-07-01T05:02:00Z'))).toBe(false);
    expect(await store.lastDigest()).toBe('2026-07-01');
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
