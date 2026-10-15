import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { EventRecorder, noAnalytics } from './analytics.js';
import { buildReport } from './analyticsReport.js';
import { createDigest, createMailer } from './feedback.js';
import { openDb } from './db.js';
import { MemoryFeedbackStore, PgFeedbackStore } from './feedbackStore.js';
import { createHttpHandler } from './http.js';
import { Lobby } from './lobby.js';

const PORT = Number(process.env.PORT ?? 8080);

// Feedback and analytics live in Postgres (DATABASE_URL), and a daily email lists what feedback is
// still open (through Resend). Without a database, feedback is kept in memory and analytics is off.
const db = process.env.DATABASE_URL ? await openDb(process.env.DATABASE_URL) : null;
if (!db) console.warn('DATABASE_URL is not set: feedback is kept in memory and analytics is off');
const recorder = db ? new EventRecorder(db) : null;
recorder?.start();
await recorder?.loadInternal();
const analytics = recorder ?? noAnalytics;

const lobby = new Lobby({
  analytics,
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

// One port serves the built client (when STATIC_DIR is set), a health check, the feedback form,
// the admin panel's API and the game's WebSocket at /ws.
const store = db ? new PgFeedbackStore(db) : new MemoryFeedbackStore();
const startedAt = Date.now();

const adminPassword = process.env.ADMIN_PASSWORD;
if (!adminPassword) console.warn('ADMIN_PASSWORD is not set: the admin panel is off');

const resendKey = process.env.RESEND_API_KEY;
const feedbackTo = process.env.FEEDBACK_TO;
if (resendKey && feedbackTo) {
  createDigest({
    store,
    mail: createMailer({
      apiKey: resendKey,
      to: feedbackTo,
      from: process.env.FEEDBACK_FROM ?? 'Hexxar <onboarding@resend.dev>',
      ...(process.env.RESEND_API_URL ? { endpoint: process.env.RESEND_API_URL } : {}),
    }),
    hour: Number(process.env.DIGEST_HOUR ?? 7),
    timeZone: process.env.DIGEST_TIMEZONE ?? 'America/Los_Angeles',
    adminUrl: `${process.env.PUBLIC_URL ?? 'https://hexxar.io'}/?admin`,
  }).start();
} else {
  console.warn('RESEND_API_KEY or FEEDBACK_TO is not set: no daily feedback email');
}
const handleHttp = createHttpHandler({
  ...(process.env.STATIC_DIR ? { staticDir: process.env.STATIC_DIR } : {}),
  store,
  analytics,
  ...(adminPassword
    ? {
        admin: {
          password: adminPassword,
          stats: () => ({ serverTime: Date.now(), startedAt, ...lobby.adminStats() }),
          ...(db ? { report: (days: number) => buildReport(db, days) } : {}),
          ...(recorder
            ? {
                internal: {
                  has: (visitorId: string) => recorder.isInternal(visitorId),
                  set: (visitorId: string, internal: boolean) =>
                    recorder.setInternal(visitorId, internal),
                },
              }
            : {}),
        },
      }
    : {}),
});
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

// A deploy stops the container with SIGTERM: write out the events still waiting first.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    void (recorder?.stop() ?? Promise.resolve()).finally(() => process.exit(0));
  });
}
