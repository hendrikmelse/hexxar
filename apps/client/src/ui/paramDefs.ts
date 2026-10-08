import type { GenerationParams } from '@hexxar/shared';

/** Which kinds of board a setting does anything for. */
export type Applies = 'always' | 'random' | 'symmetric' | 'ffa';

interface Common {
  readonly label: string;
  readonly hint: string;
  readonly applies: Applies;
}

export interface NumberDef extends Common {
  readonly kind: 'number';
  readonly key: {
    [K in keyof GenerationParams]: GenerationParams[K] extends number ? K : never;
  }[keyof GenerationParams];
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** How to show the current value; defaults to the number itself. */
  readonly format?: (value: number) => string;
}

export interface BoolDef extends Common {
  readonly kind: 'bool';
  readonly key: {
    [K in keyof GenerationParams]: GenerationParams[K] extends boolean ? K : never;
  }[keyof GenerationParams];
}

export type ParamDef = NumberDef | BoolDef;

export interface ParamGroup {
  readonly title: string;
  readonly params: readonly ParamDef[];
}

const percent = (v: number): string => `${v}%`;
const ratio = (v: number): string => `${Math.round(v * 100)}%`;

/** Every generation setting, grouped for the preview's controls. */
export const PARAM_GROUPS: readonly ParamGroup[] = [
  {
    title: 'Outline',
    params: [
      {
        kind: 'number',
        key: 'outlineScale',
        label: 'Outline size',
        hint: 'Size of the outline circle compared with a hexagon of the same radius. 0.91 holds about as many tiles.',
        min: 0.6,
        max: 1.3,
        step: 0.01,
        applies: 'random',
      },
      {
        kind: 'number',
        key: 'waveCount',
        label: 'Waves',
        hint: 'How many waves bend the outline. 0 gives a plain circle.',
        min: 0,
        max: 6,
        step: 1,
        applies: 'random',
      },
      {
        kind: 'number',
        key: 'waveStrength',
        label: 'Wave strength',
        hint: 'How far the waves push the outline in and out.',
        min: 0,
        max: 3,
        step: 0.05,
        applies: 'random',
      },
      {
        kind: 'number',
        key: 'waveDetail',
        label: 'Wave detail',
        hint: 'The highest wave frequency. Higher gives finer lobes.',
        min: 2,
        max: 10,
        step: 1,
        applies: 'random',
      },
      {
        kind: 'number',
        key: 'jaggedness',
        label: 'Jagged coast',
        hint: 'How rough the coast is, in tiles. 0 is smooth.',
        min: 0,
        max: 4,
        step: 0.1,
        applies: 'random',
      },
      {
        kind: 'number',
        key: 'minAreaRatio',
        label: 'Smallest area',
        hint: 'Shapes with less land than this share of the matching hexagon are thrown away and redrawn.',
        min: 0.3,
        max: 1,
        step: 0.01,
        format: ratio,
        applies: 'random',
      },
      {
        kind: 'number',
        key: 'maxAreaRatio',
        label: 'Largest area',
        hint: 'Shapes with more land than this share of the matching hexagon are thrown away and redrawn.',
        min: 1,
        max: 2,
        step: 0.01,
        format: ratio,
        applies: 'random',
      },
    ],
  },
  {
    title: 'Lakes',
    params: [
      {
        kind: 'number',
        key: 'tilesPerLake',
        label: 'Lake frequency',
        hint: 'About one lake per this many tiles (the actual number is random up to that). Lower means more lakes; 0 turns them off.',
        min: 0,
        max: 600,
        step: 10,
        format: (v) => (v === 0 ? 'no lakes' : `1 per ${v} tiles`),
        applies: 'random',
      },
      {
        kind: 'number',
        key: 'minLakeSize',
        label: 'Smallest lake',
        hint: 'Fewest tiles in a lake.',
        min: 3,
        max: 40,
        step: 1,
        applies: 'random',
      },
      {
        kind: 'number',
        key: 'maxLakePercent',
        label: 'Biggest lake',
        hint: 'Largest a lake can be, as a percentage of the board.',
        min: 1,
        max: 20,
        step: 0.5,
        format: (v) => `${v.toFixed(1)}% of board`,
        applies: 'random',
      },
      {
        kind: 'number',
        key: 'maxLakeSize',
        label: 'Lake size cap',
        hint: 'An absolute limit on lake size, in tiles, for big boards.',
        min: 5,
        max: 200,
        step: 5,
        applies: 'random',
      },
      {
        kind: 'number',
        key: 'lakeClearance',
        label: 'Shore room',
        hint: 'Tiles of land kept between a lake and the coast.',
        min: 1,
        max: 6,
        step: 1,
        applies: 'random',
      },
    ],
  },
  {
    title: 'Cities and villages',
    params: [
      {
        kind: 'number',
        key: 'tilesPerCity',
        label: 'City density',
        hint: 'About one extra city per this many tiles, not counting starting cities. Lower means more cities.',
        min: 10,
        max: 200,
        step: 5,
        format: (v) => `1 per ${v} tiles`,
        applies: 'symmetric',
      },
      {
        kind: 'bool',
        key: 'freeForAllCities',
        label: 'Extra cities in battle royale',
        hint: 'Battle Royale boards normally have no cities except the starting ones. Turn this on to add extra cities at the density above.',
        applies: 'ffa',
      },
      {
        kind: 'number',
        key: 'minCityDistance',
        label: 'City spacing',
        hint: 'Cities are never closer than this to each other, starting cities included.',
        min: 2,
        max: 10,
        step: 1,
        applies: 'always',
      },
      {
        kind: 'number',
        key: 'villageChance',
        label: 'Village chance',
        hint: 'Chance that a village is placed wherever one fits. 100% fills the board as full as the rules allow.',
        min: 0,
        max: 100,
        step: 5,
        format: percent,
        applies: 'always',
      },
      {
        kind: 'number',
        key: 'minVillageDistance',
        label: 'Village spacing',
        hint: 'Villages are never closer than this to each other. 2 means they never touch; 1 lets them touch.',
        min: 1,
        max: 5,
        step: 1,
        applies: 'always',
      },
      {
        kind: 'bool',
        key: 'villagesNextToCities',
        label: 'Villages may touch cities',
        hint: 'Normally villages keep away from cities so that every city keeps a full ring of farmland.',
        applies: 'always',
      },
    ],
  },
  {
    title: 'Starts and size',
    params: [
      {
        kind: 'number',
        key: 'startInset',
        label: 'Start inset',
        hint: 'Symmetric boards: starting cities sit this many tiles in from the edge.',
        min: 1,
        max: 4,
        step: 1,
        applies: 'symmetric',
      },
      {
        kind: 'number',
        key: 'startRoom',
        label: 'Start room',
        hint: 'Rings of land always kept around each starting city on random shapes.',
        min: 1,
        max: 4,
        step: 1,
        applies: 'random',
      },
      {
        kind: 'number',
        key: 'tilesPerPlayer',
        label: 'Tiles per player',
        hint: 'Battle Royale boards: how much board each player gets, which decides the board size.',
        min: 15,
        max: 100,
        step: 1,
        applies: 'ffa',
      },
    ],
  },
];
