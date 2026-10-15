import type { ClientEventName, EventBatch, EventProps } from '@hexxar/shared';
import { serverHttpUrl } from './serverUrl.js';

const VISITOR_KEY = 'hexxar.visitor';

/** A random id of 22 characters from the alphabet of `analyticsIdSchema`. */
function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

/** Has this browser been here before? Set when its id is read for the first time. */
let returning = false;

/**
 * Which browser this is: an id made up here and kept in localStorage. It is not tied to anything
 * about the person. Where storage is unavailable (some private windows) a new one is made for each
 * visit, which just counts as a new visitor.
 */
function loadVisitorId(): string {
  try {
    const saved = localStorage.getItem(VISITOR_KEY);
    if (saved && /^[A-Za-z0-9_-]{8,64}$/.test(saved)) {
      returning = true;
      return saved;
    }
    const id = randomId();
    localStorage.setItem(VISITOR_KEY, id);
    return id;
  } catch {
    return randomId();
  }
}

/**
 * Someone who has asked not to be tracked (the browser's Do Not Track setting) is not: no ids go to
 * the server and no events are sent.
 */
const enabled = typeof window !== 'undefined' && navigator.doNotTrack !== '1';

/** Which browser this is, and which page load. Absent when the person has asked not to be tracked. */
export const visitorId: string | undefined = enabled ? loadVisitorId() : undefined;
export const sessionId: string | undefined = enabled ? randomId() : undefined;

/** The ids to put in the greeting to the game server, if analytics is on. */
export const analyticsIds = (): { visitorId?: string; sessionId?: string } =>
  visitorId && sessionId ? { visitorId, sessionId } : {};

/** How long events wait, so ones that come together go in one request. */
const FLUSH_MS = 1500;

type Pending = { name: ClientEventName; props?: EventProps; at: number };
let pending: Pending[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function send(events: Pending[], leaving: boolean): void {
  if (!visitorId || !sessionId || events.length === 0) return;
  const now = Date.now();
  const body = JSON.stringify({
    visitorId,
    sessionId,
    events: events.map(({ name, props, at }) => ({
      name,
      ...(props ? { props } : {}),
      ago: Math.min(120_000, Math.max(0, now - at)),
    })),
  } satisfies EventBatch);
  try {
    // text/plain keeps it a "simple" request, so it needs no preflight even to another origin (in dev).
    void fetch(serverHttpUrl('/api/event'), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body,
      // A request that is allowed to outlive the page, for what is sent as the page is closed.
      keepalive: leaving,
    }).catch(() => undefined);
  } catch {
    // Analytics must never be the reason something breaks.
  }
}

/** Send what is waiting now (the page is going away). */
export function flushEvents(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  const events = pending;
  pending = [];
  send(events, true);
}

/** Report something that happened. It is sent in a moment, along with anything else that happens. */
export function track(name: ClientEventName, props?: EventProps): void {
  if (!enabled) return;
  pending.push({ name, ...(props ? { props } : {}), at: Date.now() });
  // A request holds 20 at most.
  if (pending.length >= 20) return flushEvents();
  timer ??= setTimeout(() => {
    timer = null;
    const events = pending;
    pending = [];
    send(events, false);
  }, FLUSH_MS);
}

if (enabled) {
  addEventListener('pagehide', flushEvents);
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushEvents();
  });
}

/** Which card or bar a choice after a match was made on. */
export type EndCard = 'defeat' | 'spectating' | 'result';

/** Report what someone chose to do once they were out of a match, or it was over. */
export function trackChoice(
  choice: 'spectate' | 'menu' | 'play_again' | 'back_to_room',
  card: EndCard,
  room: { visibility: string; settings: { mode: string } } | null,
): void {
  track('out_choice', {
    choice,
    card,
    visibility: room?.visibility ?? 'none',
    mode: room?.settings.mode ?? 'none',
  });
}

/** Report that the page was opened: whether this browser has been here, how it got here, and what kind of screen it is. */
export function trackVisit(invited: boolean): void {
  // A link can say where it was shared (hexxar.io/?ref=cool-games-list): kept as plain lowercase words.
  const ref = (new URLSearchParams(location.search).get('ref') ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '')
    .slice(0, 40);
  let referrer = 'none';
  try {
    if (document.referrer) {
      const host = new URL(document.referrer).hostname;
      referrer = host === location.hostname ? 'internal' : host.slice(0, 80);
    }
  } catch {
    referrer = 'none';
  }
  track('visit', {
    returning,
    invited,
    referrer,
    ...(ref ? { ref } : {}),
    device: matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse',
    width: Math.round(innerWidth / 100) * 100,
  });
}
