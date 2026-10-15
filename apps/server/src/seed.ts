import type { Feedback } from '@hexxar/shared';
import { openDb } from './db.js';
import { PgFeedbackStore } from './feedbackStore.js';

/**
 * Fills the feedback hub with made-up reports to click around in during development:
 * `pnpm seed`. Does nothing if there is already feedback, unless run with `--force`.
 */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const DETAILS = [
  'Page: /',
  'Browser: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36',
  'Window: 1280x720 at 1.5x',
  'Language: en-US',
  'Connected: yes',
].join('\n');

interface Sample extends Feedback {
  /** How long ago it arrived, in milliseconds. */
  readonly ago: number;
  /** How long after arriving it was resolved, if it was. */
  readonly resolvedAfter?: number;
}

const SAMPLES: Sample[] = [
  {
    ago: 12 * MINUTE,
    kind: 'bug',
    name: 'Mara',
    email: 'mara@example.com',
    message:
      'My army froze after the third tick in a duel. I could still queue orders but nothing moved, and the timer kept running.\n\nIt happened twice in a row, both times when I sent two orders on the same tile.',
    details: `${DETAILS}\nRoom: running, duel (public) K7QXP`,
  },
  {
    ago: 3 * HOUR,
    kind: 'feedback',
    message: 'Love the fog of war! Could there be a replay mode so I can watch my matches back?',
  },
  {
    ago: 9 * HOUR,
    kind: 'bug',
    name: 'Tobias',
    message: 'The tutorial gets stuck on lesson 4 when I click back and then forward again.',
    details: `${DETAILS}\nTutorial: lesson 4, page 2`,
  },
  {
    ago: 1 * DAY + 2 * HOUR,
    kind: 'feedback',
    name: 'Jun',
    email: 'jun@example.com',
    message:
      'Battle royale is great with 8+ players. A few ideas:\n- a ping or emote to signal an alliance\n- show who eliminated whom on the results card\n- let spectators see the fog of the player they follow',
  },
  {
    ago: 2 * DAY,
    kind: 'bug',
    message:
      'Sound is way too loud on the title screen on my phone and the mute button is hard to hit.',
    details: `${DETAILS.replace('1280x720 at 1.5x', '390x844 at 3x')}`,
  },
  {
    ago: 3 * DAY,
    kind: 'feedback',
    name: 'Priya',
    email: 'priya@example.com',
    message: 'Played with my brother over a private room code and it just worked. Nice job!',
    resolvedAfter: 4 * HOUR,
  },
  {
    ago: 5 * DAY,
    kind: 'bug',
    name: 'Lukas',
    message:
      'Map preview shows a tiny island that has no neighbours, so the player who spawns on it can never be reached. ' +
      'This is a long report on purpose: '.repeat(6),
    details: `${DETAILS}\nRoom: running, ffa (public) M4WZE`,
    resolvedAfter: 1 * DAY,
  },
  {
    ago: 8 * DAY,
    kind: 'feedback',
    message: 'Please add a dark/light toggle. The board is a bit too contrasty at night.',
    resolvedAfter: 2 * DAY,
  },
];

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set (see .env.example): there is nowhere to put the samples.');
  process.exit(1);
}
const db = await openDb(process.env.DATABASE_URL);
const store = new PgFeedbackStore(db);
const existing = await store.total();
if (existing > 0 && !process.argv.includes('--force')) {
  console.log(`There are already ${existing} reports; run with --force to add the samples anyway.`);
  await db.end();
  process.exit(0);
}

const now = Date.now();
// Oldest first, so they are stored in the order they would have arrived.
for (const { ago, resolvedAfter, ...feedback } of [...SAMPLES].sort((a, b) => b.ago - a.ago)) {
  const item = await store.add(feedback, new Date(now - ago));
  if (resolvedAfter !== undefined) {
    await store.setResolved(item.id, true, new Date(now - ago + resolvedAfter));
  }
}
await db.end();
console.log(`Added ${SAMPLES.length} sample reports.`);
