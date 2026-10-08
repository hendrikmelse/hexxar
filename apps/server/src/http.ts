import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

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
export function createHttpHandler(staticDir?: string) {
  const root = staticDir ? resolve(staticDir) : null;

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

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
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
