import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
    server = createServer(createHttpHandler(dir));
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

  const serve = async (send?: (feedback: unknown) => Promise<void>) => {
    const server = createServer(createHttpHandler(undefined, send as never));
    return { server, base: await listen(server) };
  };

  it('emails a good submission', async () => {
    const send = vi.fn(async () => undefined);
    const { server, base } = await serve(send);
    const response = await post(base, { kind: 'bug', message: 'It broke', email: 'a@b.co' });
    expect(response.status).toBe(200);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'bug', message: 'It broke' }),
    );
    server.close();
  });

  it('turns away what does not make sense, and what is too big', async () => {
    const send = vi.fn(async () => undefined);
    const { server, base } = await serve(send);
    expect((await post(base, { kind: 'nope', message: 'hello' })).status).toBe(400);
    expect((await post(base, { kind: 'bug', message: 'x' })).status).toBe(400);
    expect(
      (await post(base, { kind: 'bug', message: 'hello', email: 'not an email' })).status,
    ).toBe(400);
    expect((await post(base, '{not json')).status).toBe(400);
    expect((await post(base, { kind: 'bug', message: 'x'.repeat(20_000) })).status).toBe(413);
    expect(send).not.toHaveBeenCalled();
    server.close();
  });

  it('says thanks to a bot and sends nothing', async () => {
    const send = vi.fn(async () => undefined);
    const { server, base } = await serve(send);
    const response = await post(base, {
      kind: 'feedback',
      message: 'buy now',
      website: 'spam.example',
    });
    expect(response.status).toBe(200);
    expect(send).not.toHaveBeenCalled();
    server.close();
  });

  it('limits how many one address can send, and reports a failure to send', async () => {
    const { server, base } = await serve(async () => undefined);
    for (let i = 0; i < 5; i++) {
      expect((await post(base, { kind: 'feedback', message: 'hello there' })).status).toBe(200);
    }
    expect((await post(base, { kind: 'feedback', message: 'hello there' })).status).toBe(429);
    server.close();
    const failing = await serve(async () => {
      throw new Error('no');
    });
    expect((await post(failing.base, { kind: 'feedback', message: 'hello there' })).status).toBe(
      502,
    );
    failing.server.close();
  });

  it('says it is not set up when there is no way to send', async () => {
    const { server, base } = await serve(undefined);
    expect((await post(base, { kind: 'feedback', message: 'hello there' })).status).toBe(503);
    server.close();
  });
});
