import {
  hexKey,
  parseMatchConfig,
  type GameState,
  type Hex,
  type MatchConfig,
  type Order,
  type OrdersByPlayer,
  type PlayerId,
  type Tile,
} from '@hexxar/shared';
import { visionFor, type GameView } from '../game.js';
import { RIVAL, RIVAL_TWO, YOU, at, withTiles } from './maps.js';

/** The parts of the screen a lesson can draw attention to. */
export type HudTarget = 'timer' | 'pie' | 'list' | 'camera';

/** What a step can look at to decide whether the player has done what it asked. */
export interface Ctx {
  /** What the player sees, as the real game would show it. */
  readonly game: GameView;
  /** The true state of the board. */
  readonly state: GameState;
  /** How many orders the player has queued and not yet seen run. */
  readonly queueLength: number;
  /** Ticks that have run since this step began. */
  readonly ticksSinceStart: number;
  tile(hex: Hex): Tile;
  owns(hex: Hex): boolean;
}

interface Step {
  /** What the guide says. `**bold**` is supported. */
  readonly text: string;
  /** Whether ticks happen while the player reads this (they do not, by default). */
  readonly clock?: 'running' | 'paused';
  /** Tiles to point out. */
  readonly tiles?: readonly Hex[];
  /** Something on the screen to point out. */
  readonly hud?: HudTarget;
  /**
   * What the player has to do. When it is true the step is over. Steps without one are read,
   * then clicked past.
   */
  readonly done?: (ctx: Ctx) => boolean;
  /** Sets the scene when the step begins, and again if it is retried. */
  readonly setup?: (state: GameState) => GameState;
  /** If something went wrong, what to tell the player; they are then put back to try again. */
  readonly fail?: (ctx: Ctx) => string | null;
  /** Which step (by number) a failure sends the player back to; by default, this one. */
  readonly retryAt?: number;
}

export interface Lesson {
  readonly id: string;
  readonly title: string;
  readonly players: readonly PlayerId[];
  readonly names: Readonly<Record<PlayerId, string>>;
  /** The board, as rows of characters (see `maps.ts`). */
  readonly map: readonly string[];
  /** Touches up the board before the lesson begins. */
  readonly setup?: (state: GameState) => GameState;
  readonly config?: Partial<MatchConfig>;
  /** What the other players do on each tick. Stateless: the same state always gives the same orders. */
  readonly bot?: (state: GameState) => OrdersByPlayer;
  readonly steps: readonly Step[];
}

/** Slow enough to watch what is going on. */
export const TUTORIAL_TICK_MS = 2200;

export const tutorialConfig = (lesson: Lesson): MatchConfig =>
  parseMatchConfig({ tickMs: TUTORIAL_TICK_MS, fog: 'off', ...lesson.config });

const NAMES = { [YOU]: 'You', [RIVAL]: 'Rival', [RIVAL_TWO]: 'Rival 2' };
const TWO: PlayerId[] = [YOU, RIVAL];
const THREE: PlayerId[] = [YOU, RIVAL, RIVAL_TWO];

const move = (from: Hex, to: Hex): Order => ({ type: 'move', from, to });

/** How much of the owned production the player has, from the scoreboard's numbers. */
const capacityOf = (ctx: Ctx): number =>
  ctx.game.scores.find((score) => score.player === YOU)?.capacity ?? 0;

// ---------------------------------------------------------------------------------------------
// 1. Ticks and orders
// ---------------------------------------------------------------------------------------------

// A far-off rival (never moves) keeps the lesson from ending the moment you are the only one left.
const STRIP = ['.......', 'Y......', '......E'];
const stripCity = at(0, 1);

const ticks: Lesson = {
  id: 'ticks',
  title: 'Ticks and orders',
  players: TWO,
  names: NAMES,
  map: STRIP,
  setup: (state) => withTiles(state, [{ at: stripCity, set: { troops: 14 } }]),
  steps: [
    {
      text: 'Welcome to **Hexxar**! You command armies on a map of hexagonal tiles. The game does not run continuously: it moves in **ticks**. The dial in the corner fills up between ticks, and each time it completes, everything in the game happens at once.',
      hud: 'timer',
    },
    {
      text: 'You do not move armies instantly. You give **orders**, and they wait in your queue until a tick comes. The blue tile is your city, with its army. **Drag from your city onto the tile beside it** to queue a move.',
      tiles: [stripCity, at(1, 1)],
      done: (ctx) => ctx.queueLength >= 1 || ctx.ticksSinceStart >= 1,
    },
    {
      text: 'The arrow is your order, waiting. The clock is running now: **watch the dial**. When it fills, the tick comes and your army marches in.',
      clock: 'running',
      hud: 'timer',
      tiles: [at(1, 1)],
      done: (ctx) => ctx.owns(at(1, 1)),
    },
    {
      text: 'You can line up many orders. **Drag from your new tile across several tiles in one go**, to queue a whole route. They run one per tick, in order. Orders cannot be cancelled once they are queued, so think ahead!',
      clock: 'running',
      tiles: [at(1, 1), at(2, 1), at(3, 1), at(4, 1)],
      done: (ctx) => ctx.owns(at(4, 1)),
    },
    {
      text: 'That is the rhythm of the game: **plan, queue, tick**. Everyone plays on the same ticks, so a good plan queued early beats a fast reaction. Next, how armies grow.',
    },
  ],
};

// ---------------------------------------------------------------------------------------------
// 2. Making troops
// ---------------------------------------------------------------------------------------------

const FIELD = ['.......', '.......', '...Y...', '.......', '......E'];
const fieldCity = at(3, 2);
const fieldFarm = at(4, 2);

const generation: Lesson = {
  id: 'generation',
  title: 'Making troops',
  players: TWO,
  names: NAMES,
  map: FIELD,
  setup: (state) => withTiles(state, [{ at: fieldCity, set: { troops: 8, progress: 6 } }]),
  steps: [
    {
      text: 'Every tile holds an army, shown by its number. Only **cities and villages make new troops**; farmland makes none. See the ring of segments around your city? One fills each tick, and when it is full the city makes a troop. **Watch for the number to go up.**',
      clock: 'running',
      tiles: [fieldCity],
      done: (ctx) => ctx.tile(fieldCity).troops > 8,
    },
    {
      text: 'You can speed a city up. **Every farm you own next to a city or village shortens its cycle by a tick**: a city with no farms makes a troop every 8 ticks, with six farms every 2. **Capture the farm beside your city** to see the ring get faster.',
      clock: 'running',
      tiles: [fieldCity, fieldFarm],
      done: (ctx) => ctx.owns(fieldFarm),
    },
    {
      text: 'Cities make a troop every 8 down to 2 ticks. **Villages are slower**: 12 ticks with no farms, 6 with six. So the land around your producers matters as much as the producers themselves.',
      tiles: [fieldCity],
    },
    {
      text: 'One last thing: production **stops at a cap**, 50 troops for a city and 20 for a village. A producer that is full keeps its progress but waits. Do not let your armies sit idle at the cap: put them to work!',
    },
  ],
};

// ---------------------------------------------------------------------------------------------
// 3. Marching
// ---------------------------------------------------------------------------------------------

const march: Lesson = {
  id: 'march',
  title: 'Marching armies',
  players: TWO,
  names: NAMES,
  map: STRIP,
  setup: (state) => withTiles(state, [{ at: stripCity, set: { troops: 14 } }]),
  steps: [
    {
      text: 'A move sends **all but one troop** from a tile to a neighboring tile. The one left behind keeps the tile yours. **Send your army from the city onto the next tile.**',
      clock: 'running',
      tiles: [stripCity, at(1, 1)],
      done: (ctx) => ctx.owns(at(1, 1)),
    },
    {
      text: 'Armies walk one tile per tick, so a long march is a chain of orders, and each hop leaves another troop behind. **Drag from the army across to the tile three steps away** to march it out.',
      clock: 'running',
      tiles: [at(1, 1), at(2, 1), at(3, 1)],
      done: (ctx) => ctx.owns(at(3, 1)),
    },
    {
      text: 'Moving onto a tile you already own **joins the armies together**. **Drag from the army back onto the tile behind it** and watch the numbers add up.',
      clock: 'running',
      tiles: [at(3, 1), at(2, 1)],
      done: (ctx) => ctx.tile(at(2, 1)).troops >= 3,
    },
    {
      text: 'To look around, **right-drag to pan** and **scroll to zoom**. The buttons at the bottom right zoom too, and one fits the whole board on screen.',
      hud: 'camera',
    },
  ],
};

// ---------------------------------------------------------------------------------------------
// 4. Battles
// ---------------------------------------------------------------------------------------------

const FRONT = ['........', '........', 'Y..yv...', '........', '.......E'];
const frontCity = at(0, 2);
const frontFarm = at(1, 2);
const outpost = at(3, 2);
const village = at(4, 2);

const battles: Lesson = {
  id: 'battles',
  title: 'Battles',
  players: TWO,
  names: NAMES,
  map: FRONT,
  setup: (state) =>
    withTiles(state, [
      { at: frontCity, set: { troops: 12 } },
      { at: outpost, set: { troops: 4 } },
    ]),
  steps: [
    {
      text: 'Move onto a tile that is not yours and you start a **battle**. Both armies fight at their strength: the bigger one wins, and loses as many troops as the loser had. **Capture the neutral farm beside your city.** It is defended by a single troop.',
      clock: 'running',
      tiles: [frontCity, frontFarm],
      done: (ctx) => ctx.owns(frontFarm),
    },
    {
      text: 'But defenders get a **bonus** for the ground they stand on. **Farms: 100%** (no bonus). **Villages: 125%**, so 4 troops fight like 5. **Cities: 150%**, so 10 troops fight like 15. Attackers never get a bonus. Look at the village and the outpost next to it.',
      tiles: [village, outpost],
    },
    {
      text: "Your outpost has 4 troops, so **3 can attack** (one stays behind). The village's 4 troops fight as 5. **Attack the village with the outpost** and see what happens.",
      clock: 'running',
      tiles: [outpost, village],
      setup: (state) =>
        withTiles(state, [
          { at: outpost, set: { owner: YOU, troops: 4 } },
          { at: village, set: { owner: null, troops: 4 } },
        ]),
      done: (ctx) => ctx.ticksSinceStart >= 1 && ctx.queueLength === 0,
    },
    {
      text: 'That fell short: 3 attackers against 5 worth of defenders, and the defenders held. **You need more than the defense is worth.** Your outpost has been reinforced to 10 troops. **Attack the village again.**',
      clock: 'running',
      tiles: [outpost, village],
      setup: (state) =>
        withTiles(state, [
          { at: outpost, set: { owner: YOU, troops: 10 } },
          { at: village, set: { owner: null, troops: 4 } },
        ]),
      done: (ctx) => ctx.owns(village),
      fail: (ctx) =>
        ctx.ticksSinceStart >= 1 && ctx.queueLength === 0 && !ctx.owns(village)
          ? "Not quite: send the outpost's whole army at the village this time."
          : null,
    },
    {
      text: 'Nine attackers against a village worth 5: **you won and lost 5 troops**, the strength you beat. Remember: strength = troops x bonus. Take cities (150%) only with a big army, or with several armies arriving on the same tick, where the strongest fights the second strongest.',
    },
  ],
};

// ---------------------------------------------------------------------------------------------
// 5. Armies that meet
// ---------------------------------------------------------------------------------------------

const MEETING = ['......', '.YE...', '......'];
const myGate = at(1, 1);
const rivalGate = at(2, 1);

const meeting: Lesson = {
  id: 'meeting',
  title: 'Armies that meet',
  players: TWO,
  names: NAMES,
  map: MEETING,
  setup: (state) =>
    withTiles(state, [
      { at: myGate, set: { troops: 10 } },
      { at: rivalGate, set: { troops: 7 } },
    ]),
  // On the first tick the rival marches on your city, whatever you do.
  bot: (state) =>
    state.tick === 1 && (state.tiles[hexKey(rivalGate)]?.troops ?? 0) >= 2
      ? { [RIVAL]: move(rivalGate, myGate) }
      : {},
  steps: [
    {
      text: "Your rival's city is right next to yours, and they are about to attack. What happens when **two armies march into each other**? They do not slip past: they **meet halfway and fight**, with no defensive bonus for anyone.",
      tiles: [myGate, rivalGate],
    },
    {
      text: 'The rival is sending an army at your city this very tick. **Attack their city at the same time**: drag from your city onto theirs.',
      tiles: [myGate, rivalGate],
      done: (ctx) => ctx.queueLength >= 1 || ctx.ticksSinceStart >= 1,
    },
    {
      text: 'Watch the two armies meet in the middle.',
      clock: 'running',
      retryAt: 1,
      tiles: [myGate, rivalGate],
      done: (ctx) => ctx.ticksSinceStart >= 1,
      fail: (ctx) =>
        ctx.ticksSinceStart >= 1 && ctx.state.winner === null && !ctx.owns(rivalGate)
          ? 'Their army was heading for your city, and yours did not meet it. Attack their city, so you march into each other.'
          : null,
    },
    {
      text: 'Your army of 9 met their 6 halfway. **The bigger army wins and loses as many troops as it killed**: 3 of yours were left. Those survivors then **carried on to the city they were sent to** and took it. If the armies had been equal, both would have vanished.',
    },
  ],
};

// ---------------------------------------------------------------------------------------------
// 6. Fog of war
// ---------------------------------------------------------------------------------------------

const FOG = ['.........', '.........', '.Y.......', '.........', '.........'];
const fogCity = at(1, 2);
const fogVillage: Hex = { q: fogCity.q + 1, r: fogCity.r - 2 };
const hiddenCity = at(6, 2);

const fog: Lesson = {
  id: 'fog',
  title: 'Fog of war',
  players: TWO,
  names: NAMES,
  map: FOG,
  config: { fog: 'on' },
  setup: (state) =>
    withTiles(state, [
      { at: fogCity, set: { troops: 14 } },
      { at: fogVillage, set: { type: 'village', owner: RIVAL, troops: 4 } },
      { at: hiddenCity, set: { type: 'city', owner: RIVAL, troops: 10 } },
    ]),
  steps: [
    {
      text: 'You cannot see the whole map. **Your own tiles and the tiles right next to them are fully visible**: you can see every army. Everything else is hidden under clouds.',
      tiles: [fogCity],
    },
    {
      text: "Tiles **two steps away** show only their **owner and type**, no troops. See the rival's village there, at the edge of the clouds? You can tell it is theirs, and what kind of tile it is, but not how well it is defended.",
      tiles: [fogVillage],
    },
    {
      text: "The rival's capital is out there somewhere. **Explore:** drag your army east, three tiles, until the city comes into view.",
      clock: 'running',
      tiles: [at(2, 2), at(3, 2), at(4, 2)],
      done: (ctx) => {
        const level = visionFor(ctx.game)?.get(hexKey(hiddenCity));
        return level === 'far' || level === 'full';
      },
    },
    {
      text: 'There it is: you can see whose city it is, but not how many troops it holds. Scouting costs ticks, but knowing where your rivals are lets you plan. Next: how to tell who is winning.',
      tiles: [hiddenCity],
    },
  ],
};

// ---------------------------------------------------------------------------------------------
// 7. The scoreboard and winning
// ---------------------------------------------------------------------------------------------

const SCORE = ['.........', '......E..', '.Yv...F..', '......G..', '.........'];
const scoreCity = at(1, 2);
const scoreVillage = at(2, 2);

const scoreboard: Lesson = {
  id: 'scoreboard',
  title: 'The scoreboard',
  players: THREE,
  names: NAMES,
  map: SCORE,
  setup: (state) => withTiles(state, [{ at: scoreCity, set: { troops: 14 } }]),
  steps: [
    {
      text: "The **pie chart** shows who can **make troops fastest**. Each slice is a player's share of all the troop production in the game: every city and village they own, boosted by the farms around it. A bigger slice means faster growth, and over time that wins games. The white ring marks **your** slice.",
      hud: 'pie',
    },
    {
      text: "The **list** ranks players by that same production, strongest first, with each player's **total troops** beside their name. Players who have been beaten sink to the bottom. Unlike the map, the scoreboard is never hidden by fog, so you can always see how strong a rival is.",
      hud: 'list',
    },
    {
      text: 'Make your slice grow! **Capture the neutral village next to your city** and watch the pie and your place in the list.',
      clock: 'running',
      hud: 'pie',
      tiles: [scoreCity, scoreVillage],
      done: (ctx) => capacityOf(ctx) > 0.2,
    },
    {
      text: 'And that is how you win: **be the last player standing**. A player is beaten when they own **no cities or villages** and every farm they have left holds just a single troop. So you never have to hunt down every last farm: take their producers and destroy their armies. You are ready. Good luck!',
    },
  ],
};

export const LESSONS: readonly Lesson[] = [
  ticks,
  generation,
  march,
  battles,
  meeting,
  fog,
  scoreboard,
];
