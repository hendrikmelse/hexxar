import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { createHttpHandler } from './http.js';
import { Lobby } from './lobby.js';

const PORT = Number(process.env.PORT ?? 8080);

const lobby = new Lobby({
  betaCode: process.env.BETA_CODE,
  prepMs: Number(process.env.PREP_MS ?? 5000),
  earlyStartMs: Number(process.env.EARLY_START_MS ?? 60_000),
  joinWaitMs: Number(process.env.JOIN_WAIT_MS ?? 10_000),
  voteStartMs: Number(process.env.VOTE_START_MS ?? 5000),
  statsMs: Number(process.env.STATS_MS ?? 2000),
  afkMs: Number(process.env.AFK_MS ?? 120_000),
  finishedLingerMs: Number(process.env.FINISHED_LINGER_MS ?? 10 * 60_000),
});

// One port serves the built client (when STATIC_DIR is set), a health check, and the game's
// WebSocket at /ws.
const handleHttp = createHttpHandler(process.env.STATIC_DIR);
const http = createServer((req, res) => void handleHttp(req, res));
const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 16 * 1024 });

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

http.listen(PORT, () => console.log(`hexxar server listening on port ${PORT}`));
if (!process.env.BETA_CODE) console.log('BETA_CODE is not set: anyone can connect');
