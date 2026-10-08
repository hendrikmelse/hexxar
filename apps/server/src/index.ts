import { WebSocketServer } from 'ws';
import { DEFAULT_TICK_MS } from '@hexxar/shared';
import { Lobby } from './lobby.js';

const PORT = Number(process.env.PORT ?? 8080);

const lobby = new Lobby({
  allowedModes: ['duel', 'ffa'],
  defaultRadius: Number(process.env.RADIUS ?? 7),
  tickMs: Number(process.env.TICK_MS ?? DEFAULT_TICK_MS),
  countdownMs: Number(process.env.COUNTDOWN_MS ?? 5000),
  earlyStartMs: Number(process.env.EARLY_START_MS ?? 45_000),
  afkMs: Number(process.env.AFK_MS ?? 120_000),
  finishedLingerMs: Number(process.env.FINISHED_LINGER_MS ?? 10 * 60_000),
});

const wss = new WebSocketServer({ port: PORT, maxPayload: 16 * 1024 });

wss.on('connection', (ws) => {
  const handler = lobby.connect({
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
