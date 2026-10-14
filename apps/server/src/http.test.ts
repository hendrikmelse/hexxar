import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FeedbackStore } from './feedbackStore.js';
import { createHttpHandler } from './http.js';

const listen = async (server: Server): Promise<string> => {
  await new Promise<void>((done) => server.listen(0, done));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

describe('http handler', () => {
  let outer: string;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    // The client's folder sits inside another folder that holds a file that must stay private.
    outer = await mkdtemp(join(tmpdir(), 'hexxar-static-'));
    const dir = join(outer, 'dist');
    await mkdir(join(dir, 'assets'), { recursive: true });
    await writeFile(join(dir, 'index.html'), '<h1>hexxar</h1>');
    await writeFile(join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
    await writeFile(join(outer, 'secret.txt'), 'secret');
    server = createServer(createHttpHandler({ staticDir: dir }));
    base = await listen(server);
  });

  afterAll(async () => {
    server.close();
    await rm(outer, { recursive: true, force: true });
  });

  it('serves the page, with assets cached for good and the page never', async () => {
    const page = await fetch(base);
    expect(await page.text()).toBe('<h1>hexxar</h1>');
    expect(page.headers.get('cache-control')).toBe('no-cache');
    const asset = await fetch(`${base}/assets/app-abc123.js`);
    expect(asset.headers.get('content-type')).toContain('javascript');
    expect(asset.headers.get('cache-control')).toContain('immutable');
  });

  it('falls back to the page for unknown paths, but not for missing files', async () => {
    expect(await (await fetch(`${base}/somewhere/else`)).text()).toBe('<h1>hexxar</h1>');
    expect((await fetch(`${base}/assets/missing.js`)).status).toBe(404);
  });

  it('answers the health check, and refuses anything but GET', async () => {
    expect(await (await fetch(`${base}/healthz`)).text()).toBe('ok');
    expect((await fetch(base, { method: 'POST' })).status).toBe(405);
  });

  it('never serves files from outside the folder', async () => {
    expect(await (await fetch(`${base}/..%2fsecret.txt`)).text()).not.toBe('secret');
    expect(await (await fetch(`${base}/%2e%2e/secret.txt`)).text()).not.toBe('secret');
  });
});

describe('http handler without a client', () => {
  it('only has the health check', async () => {
    const server = createServer(createHttpHandler());
    const base = await listen(server);
    expect(await (await fetch(`${base}/healthz`)).text()).toBe('ok');
    expect((await fetch(base)).status).toBe(404);
    server.close();
  });
});

describe('feedback route', () => {
  const post = (base: string, body: unknown) =>
    fetch(`${base}/api/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'hexxar-store-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const serve = async (withStore = true) => {
    const store = new FeedbackStore(dir);
    const server = createServer(createHttpHandler(withStore ? { store } : {}));
    return { server, store, base: await listen(server) };
  };

  it('keeps a good submission', async () => {
    const { server, store, base } = await serve();
    const response = await post(base, { kind: 'bug', message: 'It broke', email: 'a@b.co' });
    expect(response.status).toBe(200);
    expect(store.list()).toEqual([
      expect.objectContaining({ kind: 'bug', message: 'It broke', email: 'a@b.co' }),
    ]);
    server.close();
  });

  it('turns away what does not make sense, and what is too big', async () => {
    const { server, store, base } = await serve();
    expect((await post(base, { kind: 'nope', message: 'hello' })).status).toBe(400);
    expect((await post(base, { kind: 'bug', message: 'x' })).status).toBe(400);
    expect(
      (await post(base, { kind: 'bug', message: 'hello', email: 'not an email' })).status,
    ).toBe(400);
    expect((await post(base, '{not json')).status).toBe(400);
    expect((await post(base, { kind: 'bug', message: 'x'.repeat(20_000) })).status).toBe(413);
    expect(store.total).toBe(0);
    server.close();
  });

  it('says thanks to a bot and keeps nothing', async () => {
    const { server, store, base } = await serve();
    const response = await post(base, {
      kind: 'feedback',
      message: 'buy now',
      website: 'spam.example',
    });
    expect(response.status).toBe(200);
    expect(store.total).toBe(0);
    server.close();
  });

  it('limits how many one address can send', async () => {
    const { server, base } = await serve();
    for (let i = 0; i < 5; i++) {
      expect((await post(base, { kind: 'feedback', message: 'hello there' })).status).toBe(200);
    }
    expect((await post(base, { kind: 'feedback', message: 'hello there' })).status).toBe(429);
    server.close();
  });

  it('says it is not set up when there is nowhere to keep it', async () => {
    const { server, base } = await serve(false);
    expect((await post(base, { kind: 'feedback', message: 'hello there' })).status).toBe(503);
    server.close();
  });
});

describe('admin routes', () => {
  let dir: string;
  let store: FeedbackStore;
  let server: Server;
  let base: string;
  const stats = {
    startedAt: 1,
    serverTime: 2,
    connected: 3,
    inMenu: 1,
    publicPlayers: { duel: 2, ffa: 0 },
    rooms: [],
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'hexxar-admin-'));
    store = new FeedbackStore(dir);
    server = createServer(
      createHttpHandler({ store, admin: { password: 'pässword', stats: () => stats } }),
    );
    base = await listen(server);
  });
  afterEach(async () => {
    server.close();
    await rm(dir, { recursive: true, force: true });
  });

  const call = (path: string, init: RequestInit = {}, password = 'pässword') =>
    fetch(`${base}/api/admin${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${encodeURIComponent(password)}` },
    });

  it('needs the password', async () => {
    expect((await fetch(`${base}/api/admin/stats`)).status).toBe(401);
    expect((await call('/stats', {}, 'wrong')).status).toBe(401);
    expect((await call('/feedback', {}, 'wrong')).status).toBe(401);
    expect((await call('/stats')).status).toBe(200);
  });

  it('locks out an address that keeps guessing, even for the right password', async () => {
    for (let i = 0; i < 10; i++) await call('/stats', {}, `guess${i}`);
    expect((await call('/stats', {}, 'wrong')).status).toBe(429);
    expect((await call('/stats')).status).toBe(429);
  });

  it('reports live numbers with the feedback counts', async () => {
    const item = await store.add({ kind: 'bug', message: 'one' });
    await store.add({ kind: 'bug', message: 'two' });
    await store.setResolved(item.id, true);
    const body = await (await call('/stats')).json();
    expect(body).toMatchObject({ connected: 3, feedback: { open: 1, total: 2 } });
  });

  it('lists, resolves and deletes feedback', async () => {
    const item = await store.add({ kind: 'feedback', message: 'hello there' });
    const listed = (await (await call('/feedback')).json()) as { feedback: unknown[] };
    expect(listed.feedback).toHaveLength(1);
    const resolve = (resolved: unknown) =>
      call(`/feedback/${item.id}`, { method: 'POST', body: JSON.stringify({ resolved }) });
    expect((await resolve('yes')).status).toBe(400);
    expect((await resolve(true)).status).toBe(200);
    expect(store.open()).toHaveLength(0);
    expect(
      (await call('/feedback/nope', { method: 'POST', body: '{"resolved":true}' })).status,
    ).toBe(404);
    expect((await call(`/feedback/${item.id}`, { method: 'DELETE' })).status).toBe(200);
    expect(store.total).toBe(0);
  });

  it('is off without a password', async () => {
    const off = createServer(createHttpHandler({ store }));
    const url = await listen(off);
    expect((await fetch(`${url}/api/admin/stats`)).status).toBe(503);
    off.close();
  });
});
