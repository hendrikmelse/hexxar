import { SOUNDS, SOUND_BY_ID } from './sounds.js';

/** Overall loudness, 0 to 1. */
let masterVolume = 0.3;

const MUTED_KEY = 'hexxar.muted';
let muted = readMuted();
const mutedListeners = new Set<() => void>();

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === '1';
  } catch {
    return false;
  }
}

/** Is all sound switched off? (Remembered between visits.) */
export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  if (muted === value) return;
  muted = value;
  if (master) master.gain.value = muted ? 0 : masterVolume;
  try {
    localStorage.setItem(MUTED_KEY, muted ? '1' : '0');
  } catch {
    // Not remembering the choice is harmless.
  }
  for (const listener of mutedListeners) listener();
}

/** For `useSyncExternalStore`: be told when the sound is switched on or off. */
export function subscribeMuted(listener: () => void): () => void {
  mutedListeners.add(listener);
  return () => mutedListeners.delete(listener);
}

/**
 * Sounds are decoded ahead of time into memory and played from there, so they start at once (a
 * file that has to be fetched and decoded first is what makes the first few clicks late).
 */
let context: AudioContext | null = null;
let master: GainNode | null = null;
const buffers = new Map<string, AudioBuffer>();
const loading = new Map<string, Promise<AudioBuffer | null>>();

function audioContext(): AudioContext | null {
  if (context) return context;
  try {
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = muted ? 0 : masterVolume;
    master.connect(context.destination);
    // Browsers keep audio silent until the player has done something on the page.
    const wake = (): void => {
      void context?.resume().catch(() => undefined);
    };
    for (const type of ['pointerdown', 'keydown', 'touchstart'] as const) {
      window.addEventListener(type, wake, { passive: true });
    }
  } catch {
    context = null;
  }
  return context;
}

export function setMasterVolume(volume: number): void {
  masterVolume = Math.max(0, Math.min(1, volume));
  if (master) master.gain.value = muted ? 0 : masterVolume;
}

/** Does this sound have a file yet? */
export function hasSound(id: string): boolean {
  return SOUND_BY_ID.get(id)?.file != null;
}

/** Fetch and decode one file (once). Resolves to null if it cannot be had. */
function load(file: string): Promise<AudioBuffer | null> {
  const cached = buffers.get(file);
  if (cached) return Promise.resolve(cached);
  const pending = loading.get(file);
  if (pending) return pending;
  const ctx = audioContext();
  if (!ctx) return Promise.resolve(null);
  const promise = fetch(encodeURI(`/sounds/${file}`))
    .then((response) =>
      response.ok ? response.arrayBuffer() : Promise.reject(new Error('missing')),
    )
    .then((data) => ctx.decodeAudioData(data))
    .then((buffer) => {
      buffers.set(file, buffer);
      return buffer;
    })
    .catch(() => null)
    .finally(() => loading.delete(file));
  loading.set(file, promise);
  return promise;
}

/**
 * Fetch and decode every sound that has a file, a couple at a time, in the background. Call it
 * once the page has settled, so it never competes with loading the game itself.
 */
export async function preloadSounds(): Promise<void> {
  const files = [...new Set(SOUNDS.map((entry) => entry.file).filter((f): f is string => !!f))];
  const queue = [...files];
  const worker = async (): Promise<void> => {
    for (let file = queue.shift(); file !== undefined; file = queue.shift()) await load(file);
  };
  await Promise.all([worker(), worker()]);
}

function start(buffer: AudioBuffer, volume: number): void {
  const ctx = audioContext();
  if (!ctx || !master) return;
  void ctx.resume().catch(() => undefined);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = Math.max(0, Math.min(1, volume));
  source.connect(gain).connect(master);
  source.start();
}

/**
 * Play a sound by its id (see `sounds.ts`). Does nothing for a sound that has no file yet, so the
 * game can call it everywhere a sound belongs before the sounds exist. Returns whether it played
 * (or will, if it was still loading).
 */
export function playSound(id: string, options: { volume?: number } = {}): boolean {
  const entry = SOUND_BY_ID.get(id);
  const file = entry?.file;
  if (!file || muted) return false;
  const volume = (options.volume ?? 1) * (entry?.volume ?? 1);
  const buffer = buffers.get(file);
  if (buffer) {
    start(buffer, volume);
    return true;
  }
  // Not loaded yet (the very first moments): load it, and play it as soon as it is ready.
  void load(file).then((loaded) => {
    if (loaded) start(loaded, volume);
  });
  return true;
}
