import { WebSocketServer } from 'ws';
import { DEFAULT_TICK_MS } from '@hexxar/shared';
import { GameServer } from './game-server.js';

const PORT = Number(process.env.PORT ?? 8080);

const game = new GameServer({
  players: Number(process.env.PLAYERS ?? 2),
  radius: Number(process.env.RADIUS ?? 6),
  tickMs: Number(process.env.TICK_MS ?? DEFAULT_TICK_MS),
  restartMs: Number(process.env.RESTART_MS ?? 10_000),
});

const wss = new WebSocketServer({ port: PORT, maxPayload: 16 * 1024 });

wss.on('connection', (ws) => {
  const handler = game.connect({
    send: (message) => ws.send(JSON.stringify(message)),
    close: () => ws.close(),
  });
  ws.on('message', (data) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      return;
    }
    handler.onMessage(parsed);
  });
  ws.on('close', () => handler.onClose());
});

console.log(`hexxar server listening on ws://localhost:${PORT}`);
