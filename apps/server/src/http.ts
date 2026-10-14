import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { feedbackSchema, type AdminStats } from '@hexxar/shared';
import { RateLimiter } from './feedback.js';
import type { FeedbackStore } from './feedbackStore.js';
import { sameSecret } from './secret.js';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

/**
 * The server's plain HTTP side: a health check, and (when `staticDir` is given) the built
 * client, so one process and one port serve both the page and the game's WebSocket. Paths that
 * are not files fall back to `index.html`.
 */
export interface HttpOptions {
  /** The built client, to serve as the page. */
  staticDir?: string;
  /** Where feedback is kept; without it the feedback page is told it is not set up. */
  store?: FeedbackStore;
  /** The admin panel's password and live numbers; without it the panel is off. */
  admin?: { password: string; stats: () => Omit<AdminStats, 'feedback'> };
}

export function createHttpHandler({ staticDir, store, admin }: HttpOptions = {}) {
  const root = staticDir ? resolve(staticDir) : null;
  // A few submissions an hour from one address is plenty.
  const limiter = new RateLimiter(5, 60 * 60_000);
  // Wrong admin passwords: a few tries from one address, then it is locked out for a while.
  const guesses = new RateLimiter(10, 15 * 60_000);

  const send = (res: ServerResponse, status: number, body: string): void => {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(body);
  };

  /** The file for a URL path, or null if there is none (or it points outside the root). */
  const fileFor = async (pathname: string): Promise<string | null> => {
    if (!root) return null;
    const target = resolve(join(root, normalize(pathname)));
    if (target !== root && !target.startsWith(root + sep)) return null;
    try {
      const info = await stat(target);
      if (info.isFile()) return target;
      if (info.isDirectory()) return fileFor(join(pathname, 'index.html'));
    } catch {
      // Not there.
    }
    return null;
  };

  const json = (res: ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(body));
  };

  /** The body of a request, or null if it is bigger than `max` bytes. */
  const readBody = (req: IncomingMessage, max: number): Promise<string | null> =>
    new Promise((done) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > max) {
          done(null);
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => done(Buffer.concat(chunks).toString('utf8')));
      req.on('error', () => done(null));
    });

  /** Who is asking: the address Caddy saw, if it is in front of us. */
  const callerOf = (req: IncomingMessage): string =>
    String(req.headers['x-forwarded-for'] ?? '')
      .split(',')[0]
      ?.trim() ||
    req.socket.remoteAddress ||
    'unknown';

  /** POST /api/feedback: validate the submission and keep it. */
  const handleFeedback = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!store) return json(res, 503, { error: 'Feedback is not set up yet.' });
    const body = await readBody(req, 16 * 1024);
    if (body === null) {
      // Stop listening to the rest of it once the answer is out.
      res.once('finish', () => req.destroy());
      return json(res, 413, { error: 'That is too long to send.' });
    }
    let parsed: ReturnType<typeof feedbackSchema.safeParse>;
    try {
      parsed = feedbackSchema.safeParse(JSON.parse(body));
    } catch {
      return json(res, 400, { error: 'That did not look right.' });
    }
    if (!parsed.success) return json(res, 400, { error: 'Please check the message and email.' });
    // Filled in by a script: say thanks and send nothing.
    if (parsed.data.website) return json(res, 200, { ok: true });
    if (!limiter.allow(callerOf(req))) {
      return json(res, 429, { error: 'You have sent a few already. Please try again later.' });
    }
    try {
      await store.add(parsed.data);
    } catch (error) {
      console.error('saving feedback failed', error);
      return json(res, 500, { error: 'It could not be sent. Please try again later.' });
    }
    json(res, 200, { ok: true });
  };

  /** Is the request from the admin? The password comes as `Authorization: Bearer <URI-encoded password>`. */
  const isAdmin = (req: IncomingMessage): boolean => {
    const header = String(req.headers.authorization ?? '');
    if (!admin || !header.startsWith('Bearer ')) return false;
    try {
      return sameSecret(decodeURIComponent(header.slice(7)), admin.password);
    } catch {
      return false;
    }
  };

  /** Everything under /api/admin: the live numbers and the feedback hub. */
  const handleAdmin = async (
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<void> => {
    if (!admin || !store) return json(res, 503, { error: 'The admin panel is not set up.' });
    const caller = callerOf(req);
    if (guesses.over(caller)) return json(res, 429, { error: 'Too many wrong passwords.' });
    if (!isAdmin(req)) {
      guesses.allow(caller);
      return json(res, 401, { error: 'Wrong password.' });
    }
    const route = pathname.slice('/api/admin'.length);
    if (req.method === 'GET' && route === '/stats') {
      return json(res, 200, {
        ...admin.stats(),
        feedback: { open: store.open().length, total: store.total },
      } satisfies AdminStats);
    }
    if (req.method === 'GET' && route === '/feedback') {
      return json(res, 200, { feedback: store.list() });
    }
    const id = /^\/feedback\/([\w-]{1,64})$/.exec(route)?.[1];
    if (id && req.method === 'POST') {
      const body = await readBody(req, 1024);
      let resolved: unknown;
      try {
        resolved = (JSON.parse(body ?? '') as { resolved?: unknown }).resolved;
      } catch {
        resolved = undefined;
      }
      if (typeof resolved !== 'boolean') return json(res, 400, { error: 'Say resolved or not.' });
      return json(res, (await store.setResolved(id, resolved)) ? 200 : 404, { ok: true });
    }
    if (id && req.method === 'DELETE') {
      return json(res, (await store.remove(id)) ? 200 : 404, { ok: true });
    }
    json(res, 404, { error: 'Not found.' });
  };

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const route = (req.url ?? '').split('?')[0] ?? '';
    if (route.startsWith('/api/admin/')) {
      try {
        return await handleAdmin(req, res, route);
      } catch (error) {
        console.error('admin request failed', error);
        return json(res, 500, { error: 'Something went wrong.' });
      }
    }
    if (req.method === 'POST' && route === '/api/feedback') {
      return handleFeedback(req, res);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    } catch {
      return send(res, 400, 'bad request');
    }
    if (pathname === '/healthz') return send(res, 200, 'ok');
    if (!root) return send(res, 404, 'not found');

    // Anything that is not a file is a page of the app (the client has no other routes).
    const isAsset = extname(pathname) !== '';
    const file = (await fileFor(pathname)) ?? (isAsset ? null : await fileFor('/index.html'));
    if (!file) return send(res, 404, 'not found');

    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
      // Built assets have hashed names; the page itself must always be revalidated.
      'Cache-Control': pathname.startsWith('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    });
    if (req.method === 'HEAD') return void res.end();
    createReadStream(file).pipe(res);
  };
}
