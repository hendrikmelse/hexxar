/** What the heartbeat needs of a socket. */
export interface Pingable {
  /** Has it answered since the last round? */
  alive: boolean;
  ping(): void;
  terminate(): void;
}

/**
 * One round of the heartbeat. A socket that has not answered the last ping is dead (a closed laptop,
 * a lost network: the connection never said goodbye), so it is dropped, which tells the lobby the
 * tab has gone. The rest are pinged, and must answer before the next round. Returns how many were
 * dropped.
 *
 * Without this a guest with several tabs open would look connected for as long as a dead one lasted.
 */
export function sweep(sockets: Iterable<Pingable>): number {
  let dropped = 0;
  for (const socket of [...sockets]) {
    if (!socket.alive) {
      socket.terminate();
      dropped++;
      continue;
    }
    socket.alive = false;
    try {
      socket.ping();
    } catch {
      socket.terminate();
      dropped++;
    }
  }
  return dropped;
}
