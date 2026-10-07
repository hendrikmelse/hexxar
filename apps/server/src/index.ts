import { WebSocketServer, type WebSocket } from 'ws';
import { DEFAULT_TICK_MS, clientMessageSchema, type ServerMessage } from '@hexxar/shared';

const PORT = Number(process.env.PORT ?? 8080);
const TICK_MS = Number(process.env.TICK_MS ?? DEFAULT_TICK_MS);

const wss = new WebSocketServer({ port: PORT });
let tick = 0;

function send(ws: WebSocket, msg: ServerMessage): void {
  ws.send(JSON.stringify(msg));
}

wss.on('connection', (ws) => {
  send(ws, { type: 'welcome', tickMs: TICK_MS });

  ws.on('message', (data) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      return;
    }
    const result = clientMessageSchema.safeParse(parsed);
    if (!result.success) return;
    console.log('received', result.data);
  });
});

// Placeholder tick loop: real match logic will resolve queued orders here.
setInterval(() => {
  tick++;
  const msg: ServerMessage = { type: 'tick', tick, nextTickAt: Date.now() + TICK_MS };
  for (const client of wss.clients) send(client, msg);
}, TICK_MS);

console.log(`hexxar server listening on ws://localhost:${PORT}`);
