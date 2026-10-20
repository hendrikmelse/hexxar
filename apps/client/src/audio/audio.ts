import { SOUNDS, SOUND_BY_ID } from './sounds.js';

/** Overall loudness, 0 to 1. */
/** How loud everything is: sounds are balanced against each other, and this sets them all. */
const MASTER_VOLUME = 0.3;

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
  if (master) master.gain.value = muted ? 0 : MASTER_VOLUME;
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

const MUSIC_FILE = 'background.wav';
/** How loud the music is, on its own (it does not go through the sounds' master volume). */
const MUSIC_VOLUME = 0.25;
/** How long the music takes to fade when it is switched off or on (a time constant, in seconds). */
const MUSIC_FADE_S = 0.05;
const MUSIC_MUTED_KEY = 'hexxar.musicMuted';
let musicMuted = readMusicMuted();
const musicListeners = new Set<() => void>();
let musicGain: GainNode | null = null;
let musicStarted = false;

function readMusicMuted(): boolean {
  try {
    return localStorage.getItem(MUSIC_MUTED_KEY) === '1';
  } catch {
    return false;
  }
}

/** Is the music switched off? (Remembered between visits; the sounds have a switch of their own.) */
export function isMusicMuted(): boolean {
  return musicMuted;
}

export function setMusicMuted(value: boolean): void {
  if (musicMuted === value) return;
  musicMuted = value;
  // The music goes on playing, silently, while it is off: switching it on again picks up where it
  // is, and it is never started over.
  if (musicGain && context) {
    musicGain.gain.setTargetAtTime(
      musicMuted ? 0 : MUSIC_VOLUME,
      context.currentTime,
      MUSIC_FADE_S,
    );
  }
  try {
    localStorage.setItem(MUSIC_MUTED_KEY, musicMuted ? '1' : '0');
  } catch {
    // Not remembering the choice is harmless.
  }
  if (!musicMuted) startMusic();
  for (const listener of musicListeners) listener();
}

/** For `useSyncExternalStore`: be told when the music is switched on or off. */
export function subscribeMusicMuted(listener: () => void): () => void {
  musicListeners.add(listener);
  return () => musicListeners.delete(listener);
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
    master.gain.value = muted ? 0 : MASTER_VOLUME;
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
  // Up to 2: a sound can be given a boost over the default, though a loud file may distort.
  gain.gain.value = Math.max(0, Math.min(2, volume));
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

/**
 * Start the background music, once: one buffer looped by the audio hardware itself, so it never
 * gaps, skips or restarts, whatever the page does (a game starting, the menu coming back). It is
 * only fetched if the music is on, and it is heard as soon as the browser lets the page play
 * (after the first click or key press).
 */
export function startMusic(): void {
  if (musicStarted || musicMuted) return;
  musicStarted = true;
  void load(MUSIC_FILE).then((buffer) => {
    const ctx = audioContext();
    if (!buffer || !ctx) {
      musicStarted = false;
      return;
    }
    musicGain = ctx.createGain();
    musicGain.gain.value = musicMuted ? 0 : MUSIC_VOLUME;
    musicGain.connect(ctx.destination);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(musicGain);
    source.start();
    void ctx.resume().catch(() => undefined);
  });
}
