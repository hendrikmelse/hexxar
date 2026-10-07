import { serverMessageSchema, type ClientMessage, type ServerMessage } from '@hexxar/shared';

const TOKEN_KEY = 'hexxar.token';

/**
 * Guest token, kept per tab (sessionStorage) so two tabs can play against each
 * other while testing. Real accounts replace this later.
 */
export const loadToken = (): string | undefined => {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
};

export const saveToken = (token: string): void => {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Storage can be unavailable (private windows); reconnecting just starts fresh.
  }
};

export interface Connection {
  send(message: ClientMessage): void;
}

export interface ConnectionEvents {
  onOpen(): void;
  onClose(): void;
  onMessage(message: ServerMessage): void;
  /** Return false to stop trying to reconnect. */
  shouldReconnect(): boolean;
}

/** WebSocket with automatic reconnection. */
export function connect(url: string, name: string, events: ConnectionEvents): Connection {
  let socket: WebSocket | null = null;

  const open = (): void => {
    const ws = new WebSocket(url);
    socket = ws;
    ws.onopen = () => {
      events.onOpen();
      ws.send(JSON.stringify({ type: 'hello', name, token: loadToken() }));
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
      if (events.shouldReconnect()) setTimeout(open, 2000);
    };
  };
  open();

  return {
    send(message) {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    },
  };
}
