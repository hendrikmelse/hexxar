import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { createFeedbackSender } from './feedback.js';
import { createHttpHandler } from './http.js';
import { Lobby } from './lobby.js';

const PORT = Number(process.env.PORT ?? 8080);

const lobby = new Lobby({
  betaCode: process.env.BETA_CODE,
  // 5 seconds to plan once the board is up, plus the client's 1.5 second loading screen before it.
  prepMs: Number(process.env.PREP_MS ?? 6500),
  earlyStartMs: Number(process.env.EARLY_START_MS ?? 60_000),
  joinWaitMs: Number(process.env.JOIN_WAIT_MS ?? 10_000),
  fullWaitMs: Number(process.env.FULL_WAIT_MS ?? 5000),
  voteStartMs: Number(process.env.VOTE_START_MS ?? 5000),
  statsMs: Number(process.env.STATS_MS ?? 2000),
  afkMs: Number(process.env.AFK_MS ?? 120_000),
  finishedLingerMs: Number(process.env.FINISHED_LINGER_MS ?? 10 * 60_000),
});

// One port serves the built client (when STATIC_DIR is set), a health check, and the game's
// WebSocket at /ws.
// Feedback is emailed through Resend, when it is set up (see the README).
const feedbackKey = process.env.RESEND_API_KEY;
const feedbackTo = process.env.FEEDBACK_TO;
if (!feedbackKey || !feedbackTo)
  console.warn('RESEND_API_KEY or FEEDBACK_TO is not set: feedback is off');
const sendFeedback =
  feedbackKey && feedbackTo
    ? createFeedbackSender({
        apiKey: feedbackKey,
        to: feedbackTo,
        from: process.env.FEEDBACK_FROM ?? 'Hexxar <onboarding@resend.dev>',
        ...(process.env.RESEND_API_URL ? { endpoint: process.env.RESEND_API_URL } : {}),
      })
    : undefined;
const handleHttp = createHttpHandler(process.env.STATIC_DIR, sendFeedback);
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
