/**
 * Where the game server's plain HTTP side is (the feedback form and the admin panel call it). The
 * same place as the page in production. In development the page comes from Vite, which proxies
 * `/api` to the server (see vite.config.ts), so that is the same place too; `VITE_SERVER_URL` (a
 * WebSocket address) points somewhere else, which the server must then allow across origins.
 */
export function serverHttpUrl(path: string): string {
  const socket = import.meta.env.VITE_SERVER_URL as string | undefined;
  const base = socket ? socket.replace(/^ws/, 'http').replace(/\/ws$/, '') : '';
  return `${base}${path}`;
}
