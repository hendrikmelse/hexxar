import { serverMessageSchema, type ClientMessage, type ServerMessage } from '@hexxar/shared';
import { analyticsIds } from './analytics.js';

const TOKEN_KEY = 'hexxar.token';

/**
 * Whether this tab is a guest of its own. Opening the page with `?tab` in the address does that (and
 * it lasts for the tab), for trying two players out on one computer.
 */
const OWN_GUEST_KEY = 'hexxar.ownGuest';
const ownGuest = ((): boolean => {
  try {
    if (new URLSearchParams(location.search).has('tab')) sessionStorage.setItem(OWN_GUEST_KEY, '1');
    return sessionStorage.getItem(OWN_GUEST_KEY) !== null;
  } catch {
    return false;
  }
})();

/**
 * Guest token. All the tabs of a browser share it (`localStorage`), so they are one guest: each can
 * give orders, and the others show the same game. (A tab opened with `?tab` keeps its own, in
 * `sessionStorage`.) Real accounts replace this later.
 */
const tokenStore = (): Storage => (ownGuest ? sessionStorage : localStorage);

export const loadToken = (): string | undefined => {
  try {
    return tokenStore().getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
};

export const saveToken = (token: string): void => {
  try {
    tokenStore().setItem(TOKEN_KEY, token);
  } catch {
    // Storage can be unavailable (private windows); reconnecting just starts fresh.
  }
};

export interface Connection {
  send(message: ClientMessage): void;
}

const RECONNECT_MS = 2000;

export interface ConnectionEvents {
  /** How long to wait before trying again after the connection is lost (default 2 seconds). */
  retryMs?(): number;
  onOpen(): void;
  onClose(): void;
  onMessage(message: ServerMessage): void;
}

/** WebSocket that reconnects by itself. `name` is read afresh on every (re)connect. */
export function connect(url: string, name: () => string, events: ConnectionEvents): Connection {
  let socket: WebSocket | null = null;

  const open = (): void => {
    const ws = new WebSocket(url);
    socket = ws;
    ws.onopen = () => {
      events.onOpen();
      ws.send(
        JSON.stringify({
          type: 'hello',
          name: name(),
          token: loadToken(),
          ...analyticsIds(),
        }),
      );
    };
    ws.onmessage = (event) => {
      let raw: unknown;
      try {
        raw = JSON.parse(event.data as string);
      } catch {
        return;
      }
      const parsed = serverMessageSchema.safeParse(raw);
      if (parsed.success) events.onMessage(parsed.data);
      else console.warn('unexpected server message', raw, parsed.error);
    };
    ws.onclose = () => {
      if (socket === ws) socket = null;
      events.onClose();
      setTimeout(open, events.retryMs?.() ?? RECONNECT_MS);
    };
  };
  open();

  return {
    send(message) {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    },
  };
}
