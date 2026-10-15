import {
  hexKey,
  hexNeighbors,
  parseMatchConfig,
  type GameState,
  type Hex,
  type MatchConfig,
  type OrdersByPlayer,
  type PlayerId,
  type Tile,
} from '@hexxar/shared';
import { visionFor, type GameView } from '../game.js';
import { RIVAL, RIVAL_TWO, YOU, at, withTiles } from './maps.js';

/** The parts of the screen a lesson can draw attention to. */
export type HudTarget = 'timer' | 'pie' | 'list' | 'camera' | 'reference' | 'surrender';

/** What a step can look at to decide whether the player has done what it asked. */
export interface Ctx {
  /** What the player sees, as the real game would show it. */
  readonly game: GameView;
  /** The true state of the board. */
  readonly state: GameState;
  /** How many orders the player has queued and not yet seen run. */
  readonly queueLength: number;
  /** How many of the player's orders have run since this step began. */
  readonly ordersRun: number;
  /** Ticks that have run since this step began. */
  readonly ticksSinceStart: number;
  tile(hex: Hex): Tile;
  owns(hex: Hex): boolean;
}

interface Step {
  /** What the guide says. `**bold**` is supported. */
  readonly text: string;
  /**
   * Whether ticks happen while the player reads this: `paused` (the default), `running`, or
   * `after-order`, which waits until the player has queued an order and then starts.
   */
  readonly clock?: 'running' | 'paused' | 'after-order';
  /** A button that starts the clock when the player has read the page and is ready to watch. */
  readonly startButton?: string;
  /** Going forward onto this page keeps the board as the player left it, instead of resetting it. */
  readonly carry?: boolean;
  /** Tiles to point out with an outline. */
  readonly tiles?: readonly Hex[];
  /** Tiles to point out once the step's task is done (such as the thing the player was looking for). */
  readonly doneTiles?: readonly Hex[];
  /** Tiles whose generation ring to point out with a yellow outline. */
  readonly rings?: readonly Hex[];
  /** Show the player what to do: a pointer dragging across these tiles, over and over. */
  readonly drag?: readonly Hex[];
  /** Something on the screen to point out, with an arrow and (unless turned off) an outline. */
  readonly hud?: HudTarget;
  readonly hudOutline?: boolean;
  /**
   * What the player has to do. Once it is done the player can go on (they still press Next).
   * Steps without one are just read.
   */
  readonly done?: (ctx: Ctx) => boolean;
  /** Sets the scene when the step begins, and again if it is retried. */
  readonly setup?: (state: GameState) => GameState;
  /** If something went wrong, what to tell the player; the page waits for them to press Reset. */
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

/** The same length as a real match's default tick. */
export const TUTORIAL_TICK_MS = 1000;

export const tutorialConfig = (lesson: Lesson): MatchConfig =>
  parseMatchConfig({ tickMs: TUTORIAL_TICK_MS, fog: 'off', ...lesson.config });

const NAMES = { [YOU]: 'You', [RIVAL]: 'Rival', [RIVAL_TWO]: 'Rival 2' };
const TWO: PlayerId[] = [YOU, RIVAL];
const THREE: PlayerId[] = [YOU, RIVAL, RIVAL_TWO];

// ---------------------------------------------------------------------------------------------
// 1. Ticks and orders
// ---------------------------------------------------------------------------------------------

// Just you: with no rival there is nobody to beat, and a match with one player never ends.
const STRIP = [' ......', '.Y.....', ' ......'];
const stripCity = at(1, 1);

const ticks: Lesson = {
  id: 'ticks',
  title: 'Ticks and orders',
  players: [YOU],
  names: NAMES,
  map: STRIP,
  setup: (state) => withTiles(state, [{ at: stripCity, set: { troops: 14 } }]),
  steps: [
    {
      text: 'Welcome to **Hexxar**! You command armies on a map of hexagonal tiles. The game advances in **ticks**. Ticks occurr at fixed intervals, indicated by the dial in the **top left corner**.',
      clock: 'running',
      hud: 'timer',
      hudOutline: false,
    },
    {
      text: 'You give **orders**, and they wait in your queue until a tick occurs. **Drag from your blue city onto the tile beside it** to queue a move. Then watch it execute.',
      clock: 'after-order',
      drag: [stripCity, at(2, 1)],
      done: (ctx) => ctx.owns(at(2, 1)),
    },
    {
      text: 'Orders run one per tick, in order, and cannot be cancelled once queued. **Drag from your new tile across several tiles** to queue several consecutive orders. Capture the indicated tile.\n\nNothing enters the queue until you **let go**. While dragging, backtrack to undo, or press **Escape** to cancel.',
      clock: 'after-order',
      // Where the page before leaves you: the tile beside your city taken, with the army on it.
      setup: (state) =>
        withTiles(state, [
          { at: stripCity, set: { troops: 1 } },
          { at: at(2, 1), set: { owner: YOU, troops: 12 } },
        ]),
      tiles: [at(5, 1)],
      drag: [at(2, 1), at(3, 1), at(4, 1), at(5, 1)],
      done: (ctx) => ctx.owns(at(5, 1)),
    },
  ],
};

// ---------------------------------------------------------------------------------------------
// 2. Making troops
// ---------------------------------------------------------------------------------------------

// The same board as the first lesson, with the city in the same place. A village goes in with one
// tile between it and the city, but not until the page that is about it.
const FIELD = STRIP;
const fieldCity = stripCity;
// The farms around the city, in order round it: each touches the next.
const fieldRing = hexNeighbors(fieldCity);
const fieldVillage = at(3, 1);
// The tile between them.
const fieldBridge = at(2, 1);
// Two tiles beyond the village: one nobody owns, to show what a village looks like before it is taken.
const fieldNeutralVillage = at(5, 1);

const generation: Lesson = {
  id: 'generation',
  title: 'Making troops',
  players: [YOU],
  names: NAMES,
  map: FIELD,
  // The ring is two segments short of full, so the second tick makes a troop. The city has an
  // army big enough to walk out round all six farms on the next page (each step costs two troops).
  setup: (state) => withTiles(state, [{ at: fieldCity, set: { troops: 19, progress: 6 } }]),
  steps: [
    {
      text: 'Every tile holds an army, shown by its number. Some tiles make new troops. The ring shown on your city tile fills by one segment each tick. When it fills up, the city generates one troop.\n\nPress the button below to start the clock, and **watch as a new troop is generated.**',
      startButton: 'Start the clock',
      rings: [fieldCity],
      done: (ctx) => ctx.tile(fieldCity).troops > 19,
    },
    {
      text: '**Every farm you own next to a city shortens its cycle by a tick**. Cities with no adjacent farms generate one troop every **8 ticks**, but will generate a troop every **2 ticks** when fully surrounded. **Capture all six farms adjacent to your city** and watch as segments disappear from the ring.',
      clock: 'running',
      // Where the page before leaves you: the city has made its troop.
      setup: (state) => withTiles(state, [{ at: fieldCity, set: { troops: 20, progress: 0 } }]),
      // The six farms round the city, each touching the next: one drag takes them all.
      drag: [fieldCity, ...fieldRing],
      done: (ctx) => fieldRing.every((hex) => ctx.owns(hex)),
    },
    {
      text: '**Villages** make troops too, but more slowly than cities: every **12 ticks** with no adjacent farms, and every **6 ticks** when fully surrounded. Farmland does not produce any troops on its own.',
      clock: 'running',
      // The village appears only now, so it won't be shown before it is explained, and it is yours,
      // so that its ring shows.
      setup: (state) =>
        withTiles(state, [
          { at: fieldCity, set: { troops: 9, progress: 0 } },
          { at: fieldBridge, set: { owner: YOU, troops: 1 } },
          { at: fieldVillage, set: { type: 'village', owner: YOU, troops: 4 } },
          { at: fieldNeutralVillage, set: { type: 'village', troops: 4 } },
        ]),
      tiles: [fieldVillage],
    },
    {
      // Both producers sit at their caps with empty rings: nothing fills while they are full.
      setup: (state) =>
        withTiles(state, [
          { at: fieldCity, set: { troops: 50, progress: 0 } },
          { at: fieldBridge, set: { owner: YOU, troops: 1 } },
          { at: fieldVillage, set: { type: 'village', owner: YOU, troops: 20, progress: 0 } },
          { at: fieldNeutralVillage, set: { type: 'village', troops: 4 } },
        ]),
      clock: 'running',
      text: 'Production **stops at a cap**. Cities stop production at **50 troops**, and villages stop production at **20 troops**.',
    },
  ],
};

// ---------------------------------------------------------------------------------------------
// 3. Battles
// ---------------------------------------------------------------------------------------------

// A game partway through: you on the left, the rival on the right, neutral ground in between. Each
// side's land is in one piece.
// Two columns narrower than it began, with the corners cut off, so the board is a rounded strip.
// (The left end stays square: your city's ring of neighbors must all be on the board.)
const FRONT = [' ....... ', '..yyFee. ', '.YyyeeeE.', '..yyee.. ', ' ....... '];
const frontFarm = at(3, 2);
const rivalFarm = at(4, 2);
const outpost = at(3, 1);
const village = at(4, 1);
// What the first page leaves behind: the rival's farm taken by the 5 troops sent at its 2.
const takenFarm = [
  { at: frontFarm, set: { troops: 1 } },
  { at: rivalFarm, set: { owner: YOU, troops: 3 } },
];

const battles: Lesson = {
  id: 'battles',
  title: 'Battles',
  players: TWO,
  names: NAMES,
  map: FRONT,
  setup: (state) =>
    withTiles(state, [
      { at: frontFarm, set: { troops: 6 } },
      { at: rivalFarm, set: { troops: 2 } },
      { at: outpost, set: { troops: 6 } },
    ]),
  steps: [
    {
      text: "Move onto an opponent's tile to perform a **battle**. The bigger army wins, and loses a number of troops equal to the strength of the loser's army. **Attack the rival's farm** next to your land.",
      clock: 'after-order',
      drag: [frontFarm, rivalFarm],
      done: (ctx) => ctx.owns(rivalFarm),
    },
    {
      text: '**Villages and cities** have a **defensive bonus**: **+25% for villages** and **+50% for cities**. Attackers never get a bonus.\n\n**Attack the village** and watch what happens.',
      clock: 'after-order',
      drag: [outpost, village],
      setup: (state) =>
        withTiles(state, [
          ...takenFarm,
          { at: outpost, set: { owner: YOU, troops: 6 } },
          { at: village, set: { owner: RIVAL, troops: 4 } },
        ]),
      // The 5 attackers tie with the village's 4 (which count as 5): the village is left empty.
      done: (ctx) => ctx.ordersRun >= 1 && ctx.tile(village).troops === 0,
      fail: (ctx) =>
        ctx.ordersRun >= 1 && ctx.tile(village).troops !== 0
          ? "Not quite: send the outpost's whole army at the village."
          : null,
    },
    {
      // Where the page before leaves you: the attack tied, so the rival still owns the village, with no troops.
      setup: (state) =>
        withTiles(state, [
          ...takenFarm,
          { at: outpost, set: { owner: YOU, troops: 1 } },
          { at: village, set: { owner: RIVAL, troops: 0 } },
        ]),
      text: "If two armies attempt to swap tiles in the same tick, they meet halfway and fight with no bonuses. The winner's remaining troops continue to their destination.",
    },
  ],
};

// ---------------------------------------------------------------------------------------------
// 4. Fog of war
// ---------------------------------------------------------------------------------------------

const FOG = ['.........', '.........', '.Y.......', '.........', '.........'];
const fogCity = at(1, 2);
// Two steps up and to the right of your city: the rival's village.
const fogVillage: Hex = { q: fogCity.q + 1, r: fogCity.r - 2 };
// Two steps down and to the right: a village nobody owns.
const fogFreeVillage: Hex = { q: fogCity.q, r: fogCity.r + 2 };
const hiddenCity = at(6, 3);
// The rival's land runs from the village on the top row round to their city.
const rivalLine = [at(2, 0), at(3, 0), at(4, 0), at(5, 0), at(5, 1), at(6, 2)];

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
      { at: fogFreeVillage, set: { type: 'village', troops: 4 } },
      { at: hiddenCity, set: { type: 'city', owner: RIVAL, troops: 10 } },
      ...rivalLine.map((hex) => ({ at: hex, set: { owner: RIVAL } })),
    ]),
  steps: [
    {
      text: "In a real game, you cannot see the whole map. **Tiles adjacent** to your own are **fully visible**. Tiles **two steps away** show their **owner and type, but not the troop count**. Everything else is hidden in the fog.\n\nThe rival's city is out there somewhere. **Explore until you find it.**",
      clock: 'running',
      doneTiles: [hiddenCity],
      done: (ctx) => {
        const level = visionFor(ctx.game)?.get(hexKey(hiddenCity));
        return level === 'far' || level === 'full';
      },
    },
  ],
};

// ---------------------------------------------------------------------------------------------
// 5. The interface
// ---------------------------------------------------------------------------------------------

// No city is on the edge, and no city touches another city or a village. Each color's land is in
// one piece: the rival's city, village and the two farms joining them, and the other rival's city
// with a farm either side.
const SCORE = ['.......', '.Y.v.E.', '.....ee', '.G...F.', '.......'];
const scoreCity = at(1, 1);
const scoreVillage = at(3, 1);
const otherRivalLand = [at(0, 3), at(2, 3)];

const scoreboard: Lesson = {
  id: 'interface',
  title: 'The interface',
  players: THREE,
  names: NAMES,
  map: SCORE,
  setup: (state) =>
    withTiles(state, [
      { at: scoreCity, set: { troops: 14 } },
      ...otherRivalLand.map((hex) => ({ at: hex, set: { owner: RIVAL_TWO } })),
    ]),
  steps: [
    {
      text: 'To look around, **right-click and drag**. Use the **scroll wheel to zoom in and out**, or use the buttons in the bottom right. The last button fits the whole board onto the screen.',
      hud: 'camera',
    },
    {
      text: 'The **?** button opens the **reference sheet**. It shows you how fast cities and villages make troops, and their **defensive bonuses**. It is there whenever you need it during a match.',
      hud: 'reference',
    },
    {
      text: 'The **Surrender** button in the bottom left gives up the match. Press it **twice** to make sure you meant it. Your troops become neutral and the match goes on without you. It does nothing here in the tutorial.',
      hud: 'surrender',
    },
    {
      text: 'The **pie chart** shows the **relative troop producion rate** for all players. The white line marks **your** slice.',
      hud: 'pie',
    },
    {
      text: "The **list** ranks players by production. Each player's **mobile troop count** is beside their name. Mobile troop count is the total number of troops minus the one troop per territory that cannot move. Unlike the map, the pie and list **are not obscured by fog**.",
      hud: 'list',
    },
    {
      text: 'Make your slice grow! **Capture the neutral village** and watch the pie and the list.',
      clock: 'running',
      done: (ctx) => ctx.owns(scoreVillage),
    },
    {
      text: '**You win by being the last player standing.** A player is eliminated when they have no cities or villages and no mobile troops. If a player surrenders or is eliminated, their troops become neutral.',
      carry: true,
    },
  ],
};

export const LESSONS: readonly Lesson[] = [ticks, generation, battles, fog, scoreboard];
