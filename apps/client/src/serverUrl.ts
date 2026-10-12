/**
 * Where the game server's plain HTTP side is (the feedback form posts there). The same place as the
 * page in production; in development the server runs on its own port; `VITE_SERVER_URL` (a
 * WebSocket address) points somewhere else.
 */
export function serverHttpUrl(path: string): string {
  const socket = import.meta.env.VITE_SERVER_URL as string | undefined;
  const base = socket
    ? socket.replace(/^ws/, 'http').replace(/\/ws$/, '')
    : import.meta.env.DEV
      ? `http://${location.hostname}:8080`
      : location.origin;
  return `${base}${path}`;
}
