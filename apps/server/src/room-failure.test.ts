import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Board generation is random and its rules change over time; make it fail on demand.
const generation = vi.hoisted(() => ({ failures: 0, calls: 0 }));
vi.mock('@hexxar/shared', async (importOriginal) => {
  const shared = await importOriginal<typeof import('@hexxar/shared')>();
  return {
    ...shared,
    createSymmetricMatch: (...args: Parameters<typeof shared.createSymmetricMatch>) => {
      generation.calls++;
      if (generation.failures > 0) {
        generation.failures--;
        throw new Error('could not make a board shape that fits');
      }
      return shared.createSymmetricMatch(...args);
    },
  };
});

const { Lobby } = await import('./lobby.js');
const { FakeClient, options } = await import('./test-helpers.js');

describe('a board that cannot be generated', () => {
  let lobby: InstanceType<typeof Lobby>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    generation.failures = 0;
    generation.calls = 0;
    lobby = new Lobby(options);
  });

  afterEach(() => {
    lobby.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const startDuel = () => {
    const a = new FakeClient(lobby).hello('Ann');
    const b = new FakeClient(lobby).hello('Bob');
    a.say({ type: 'quickPlay', mode: 'duel' });
    b.say({ type: 'quickPlay', mode: 'duel' });
    return { a, b };
  };

  it('is retried with another seed, and the match starts if that works', () => {
    generation.failures = 2;
    const { a, b } = startDuel();
    expect(generation.calls).toBe(3);
    expect(a.room?.state).toBe('running');
    expect(b.last('snapshot').state.players).toHaveLength(2);
  });

  it('closes the room with an apology instead of crashing the server', () => {
    generation.failures = Infinity;
    const { a, b } = startDuel();
    for (const client of [a, b]) {
      expect(client.last('rejected').reason).toMatch(/could not be set up/);
      expect(client.room).toBeNull();
    }
    // The server carries on: the same people can try again, and a board that works starts a match.
    generation.failures = 0;
    a.say({ type: 'quickPlay', mode: 'duel' });
    b.say({ type: 'quickPlay', mode: 'duel' });
    expect(a.room?.state).toBe('running');
  });
});
