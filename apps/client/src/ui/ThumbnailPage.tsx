import { useEffect } from 'react';
import {
  DEFAULT_GENERATION_PARAMS,
  bowlRadiusFor,
  createFreeForAllMatch,
  createRng,
  hexDistance,
  hexKey,
  hexNeighbors,
  parseMatchConfig,
  type GameState,
  type Hex,
  type Order,
  type Rng,
  type Tile,
} from '@hexxar/shared';
import { paletteColor } from '../board.js';
import { emptyGame, type GameView } from '../game.js';
import { preview } from '../preview.js';
import { Logo } from './Logo.js';

const PLAYERS = 4;
/** How many tiles each player holds on the thumbnail's board. */
const TERRITORY = 20;
/** How many steps their arrows take them. */
const ARROW_STEPS = 10;

const at = (tile: Hex): Hex => ({ q: tile.q, r: tile.r });

/** Give each player a patch of land around their start, to look like a match under way. */
function claimTerritory(state: GameState, tiles: Record<string, Tile>, rng: Rng): Tile[][] {
  const owned: Tile[][] = [];
  for (const player of state.players) {
    const start = Object.values(state.tiles).find((tile) => tile.owner === player);
    const mine: Tile[] = start ? [start] : [];
    const queue = start ? [start] : [];
    while (queue.length > 0 && mine.length < TERRITORY) {
      const from = queue.shift()!;
      const around = hexNeighbors(from)
        .map((hex) => tiles[hexKey(hex)])
        .filter((tile): tile is Tile => tile !== undefined && tile.owner === null);
      // Shuffled, so the patch is ragged rather than a neat hexagon.
      around.sort(() => rng.next() - 0.5);
      for (const tile of around) {
        if (mine.length >= TERRITORY || rng.next() < 0.25) continue;
        const claimed: Tile = { ...tile, owner: player, troops: 1 + rng.int(9) };
        tiles[hexKey(claimed)] = claimed;
        mine.push(claimed);
        queue.push(claimed);
      }
    }
    owned.push(mine);
  }
  return owned;
}

/** A run of orders from the edge of someone's land out across the board, away from where they began. */
function arrowsFrom(mine: Tile[], state: GameState, rng: Rng): Order[] {
  const start = mine[0];
  if (!start) return [];
  const taken = new Set<string>();
  let from: Hex = at(
    mine.reduce((far, tile) => (hexDistance(tile, start) > hexDistance(far, start) ? tile : far)),
  );
  taken.add(hexKey(from));
  const orders: Order[] = [];
  for (let step = 0; step < ARROW_STEPS; step++) {
    const options = hexNeighbors(from).filter(
      (hex) => state.tiles[hexKey(hex)] !== undefined && !taken.has(hexKey(hex)),
    );
    if (options.length === 0) break;
    // Mostly outward, with a little wandering.
    options.sort(
      (a, b) => hexDistance(b, start) - hexDistance(a, start) + (rng.next() - 0.5) * 1.5,
    );
    const to = options[0]!;
    orders.push({ type: 'move', from, to: at(to) });
    taken.add(hexKey(to));
    from = at(to);
  }
  return orders;
}

/**
 * The thumbnail, at `/?thumbnail` (development only): the game's name and logo over a
 * board with a few players' land and their queued orders. Open it at the size of the picture
 * wanted and take a screenshot. `?seed=` picks another board.
 */
export function ThumbnailPage() {
  useEffect(() => {
    const seed = Number(new URLSearchParams(location.search).get('seed')) || 20260;
    const ids = Array.from({ length: PLAYERS }, (_, i) => `p${i}`);
    const { state } = createFreeForAllMatch({
      players: ids,
      seed,
      params: { ...DEFAULT_GENERATION_PARAMS, bowlRadius: bowlRadiusFor('small', PLAYERS) },
    });
    const rng = createRng(seed);
    const tiles = { ...state.tiles };
    const owned = claimTerritory(state, tiles, rng);
    const queues = owned.map((mine, index) => ({
      queue: arrowsFrom(mine, state, createRng(seed + index)),
      color: paletteColor(index),
    }));
    // Farms hold a single troop, except the ones their own player's arrows set out from: those
    // have an army. (An arrow of another color setting out from them changes nothing.)
    const origins = new Map(
      state.players.map((player, index) => [
        player,
        new Set(queues[index]!.queue.map((order) => hexKey(order.from))),
      ]),
    );
    for (const [key, tile] of Object.entries(tiles)) {
      if (tile.type !== 'farmland') continue;
      const armed = tile.owner !== null && origins.get(tile.owner)?.has(key);
      tiles[key] = { ...tile, troops: armed ? 3 + rng.int(7) : 1 };
    }
    const view: GameView = {
      ...emptyGame(),
      status: 'playing',
      playerId: null,
      config: parseMatchConfig({ fog: 'off' }),
      tiles,
      players: [...state.players],
    };
    const show = (): void => {
      preview.show(view);
      preview.queues(queues);
    };
    show();
    window.addEventListener('resize', show);
    return () => window.removeEventListener('resize', show);
  }, []);

  return (
    <div className="thumbnail">
      <div className="thumbnail-title">
        <Logo />
      </div>
    </div>
  );
}
