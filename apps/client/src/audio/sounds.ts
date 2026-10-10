/**
 * Every sound the game should make, in one list: what it is, and where it belongs. `file` is the
 * sound file under `public/sounds/` (null until it is made). The dev sound page (`/?sounds`) lists
 * these and plays the ones that have a file; `playSound` in `audio.ts` is how the game plays them.
 */
export interface SoundDef {
  /** Dotted name used in code: `playSound('army.land')`. */
  readonly id: string;
  readonly name: string;
  readonly group: SoundGroup;
  /** What it should sound like and feel like. */
  readonly description: string;
  /** What triggers it, and roughly where in the code. */
  readonly where: string;
  /** File name in `public/sounds/`, once there is one. */
  readonly file: string | null;
  /** Where the file came from, for crediting and for finding a better one. */
  readonly source: string | null;
  /** How loud this sound is next to the others, 0 to 1 (1 if not set). */
  readonly volume: number;
}

export const SOUND_GROUPS = [
  'Interface',
  'Lobby',
  'Match flow',
  'Orders',
  'Armies and battles',
  'Players and results',
  'Tutorial',
] as const;
export type SoundGroup = (typeof SOUND_GROUPS)[number];

/**
 * Which file each sound uses (and where it came from). Fill in `file` (a name in
 * `public/sounds/`, such as 'ui.click.mp3') to give a sound its file; an empty string means there
 * is no sound yet. `source` is a note on where it came from. `volume` (0 to 1, default 1) turns one
 * sound down next to the rest.
 */
const FILES: Readonly<Record<string, { file: string; source: string; volume?: number }>> = {
  'ui.click': {
    file: 'ImpactSounds/footstep_concrete_000.ogg',
    source: 'Kenney - Impact Sounds - footstep_concrete_000.ogg',
  },
  'ui.back': { file: 'UIAudio/click4.ogg', source: 'Kenney - UI Audio - click4.ogg' },
  'ui.error': {
    file: 'InterfaceSounds/switch_003.ogg',
    source: 'Kenney - Interface Sounds - switch_003.ogg',
  },
  'lobby.join': {
    file: 'InterfaceSounds/drop_003.ogg',
    source: 'Kenney - Interface Sounds - drop_003.ogg',
  },
  'lobby.leave': {
    file: 'InterfaceSounds/bong_001.ogg',
    source: 'Kenney - Interface Sounds - bong_001.ogg',
  },
  'lobby.found': { file: '', source: '' },
  'lobby.count': {
    file: 'InterfaceSounds/tick_001.ogg',
    source: 'Kenney - Interface Sounds - tick_001.ogg',
  },
  'match.begin': {
    file: 'ImpactSounds/impactBell_heavy_000.ogg',
    source: 'Kenney - Impact Sounds - impactBell_heavy_000.ogg',
  },
  'order.select': { file: '', source: '' },
  'order.step': {
    file: 'ImpactSounds/footstep_wood_000.ogg',
    source: 'Kenney - Impact Sounds - footstep_wood_000.ogg',
  },
  'order.queue': { file: '', source: '' },
  'order.refused': {
    file: 'InterfaceSounds/back_001.ogg',
    source: 'Kenney - Interface Sounds - back_001.ogg',
  },
  'army.depart': {
    file: 'RPGAudio/handleSmallLeather2.ogg',
    source: 'Kenney - RPG Audio - handleSmallLeather2.ogg',
  },
  'tile.capture': {
    file: 'ImpactSounds/impactPlank_medium_000.ogg',
    source: 'Kenney - Impact Sounds - impactPlank_medium_000.ogg',
  },
  'tile.lost': {
    file: 'ImpactSounds/impactPunch_heavy_000.ogg',
    source: 'Kenney - Impact Sounds - impactPunch_heavy_000.ogg',
  },
  'tile.captureFailed': {
    file: 'ImpactSounds/impactMetal_medium_001.ogg',
    source: 'Kenney - Impact Sounds - impactMetal_medium_001.ogg',
  },
  'tile.defended': {
    file: 'ImpactSounds/impactMetal_heavy_000.ogg',
    source: 'Kenney - Impact Sounds - impactMetal_heavy_000.ogg',
  },
  'player.out': {
    file: 'InterfaceSounds/drop_003.ogg',
    source: 'Kenney - Interface Sounds - drop_003.ogg',
  },
  'result.defeat': {
    file: 'ImpactSounds/impactBell_heavy_002.ogg',
    source: 'Kenney - Impact Sounds - impactBell_heavy_002.ogg',
  },
  'result.gameOver': {
    file: 'MusicJingles/SaxJingles/jingles_SAX09.ogg',
    source: 'Kenney - Music Jingles - jingles_SAX09.ogg',
  },
  'result.victory': {
    file: 'MusicJingles/SaxJingles/jingles_SAX10.ogg',
    source: 'Kenney - Music Jingles - jingles_SAX10.ogg',
  },
  'tutorial.next': {
    file: 'RPGAudio/bookFlip3.ogg',
    source: 'Kenney - RPG Audio - bookFlip3.ogg',
  },
  'tutorial.task': {
    file: 'MusicJingles/PizzicatoJingles/jingles_PIZZI04.ogg',
    source: 'Kenney - Music Jingles - jingles_PIZZI04.ogg',
    volume: 0.5,
  },
  'tutorial.fail': {
    file: 'InterfaceSounds/error_006.ogg',
    source: 'Kenney - Interface Sounds - error_006.ogg',
  },
  'tutorial.finished': { file: '', source: '' },
};

const sound = (
  id: string,
  name: string,
  group: SoundGroup,
  description: string,
  where: string,
): SoundDef => ({
  id,
  name,
  group,
  description,
  where,
  file: FILES[id]?.file || null,
  source: FILES[id]?.source || null,
  volume: FILES[id]?.volume ?? 1,
});

export const SOUNDS: readonly SoundDef[] = [
  // -- Interface -------------------------------------------------------------------------
  sound(
    'ui.click',
    'Button click',
    'Interface',
    'A soft, short press. Used by every button, including the main action on a screen (Play, Start, Main menu).',
    'Any <button> press in the menu, lobby, HUD and cards (one delegated listener); also covers the "primary" buttons.',
  ),
  sound(
    'ui.back',
    'Back / leave',
    'Interface',
    'A descending, closing sound for backing out of something.',
    'Leave lobby, Back in the tutorial, Exit tutorial, leaving the match.',
  ),
  sound(
    'ui.error',
    'Refused / error toast',
    'Interface',
    'A dull, low buzz or thud. Something you tried was not allowed.',
    'The red toast: the server refused something (App.tsx Toast, error).',
  ),
  // -- Lobby -----------------------------------------------------------------------------
  sound(
    'lobby.join',
    'Player joins',
    'Lobby',
    'A cheerful pop as a name appears in the list.',
    'Someone else joins your room (Lobby.tsx, the player list growing).',
  ),
  sound(
    'lobby.leave',
    'Player leaves',
    'Lobby',
    'The reverse of the join pop: a quick falling blip.',
    'Someone leaves your room before the match.',
  ),
  sound(
    'lobby.found',
    'Opponent found',
    'Lobby',
    'A confirming, slightly dramatic stab: the duel is on. This is the main "match found" sound.',
    'Second player joins a quick-play duel; the countdown starts running.',
  ),
  sound(
    'lobby.count',
    'Countdown tick',
    'Lobby',
    'A short tick, once a second, over the last few seconds before the match starts.',
    'The lobby countdown reaching 3, 2, 1.',
  ),
  // -- Match flow ------------------------------------------------------------------------
  sound(
    'match.begin',
    'Match begins',
    'Match flow',
    'The board appears: an airy swell and a landing note.',
    'The loading screen giving way to the board.',
  ),
  // -- Orders ----------------------------------------------------------------------------
  sound(
    'order.select',
    'Pick up an army',
    'Orders',
    'A tiny click as you press on a tile you can command.',
    'Pointer down on a commandable tile (the start of a drag).',
  ),
  sound(
    'order.step',
    'Path step',
    'Orders',
    'A light tick for each tile the drag crosses, rising a little in pitch along the path.',
    'PathDraft adding a hex while you drag.',
  ),
  sound(
    'order.queue',
    'Order queued',
    'Orders',
    'A confirming snap or stamp as the path is committed. Scales slightly with path length.',
    'Drag released and orders sent; the "queued" reply from the server.',
  ),
  sound(
    'order.refused',
    'Order refused',
    'Orders',
    'A short negative blip. Used when an order is rejected, and when you cancel a drag with Escape.',
    'Server "rejected" during a match; the cancel handler in main.ts (Escape).',
  ),
  // -- Armies and battles ----------------------------------------------------------------
  sound(
    'army.depart',
    'Army sets off',
    'Armies and battles',
    'A short marching whoosh as a token leaves its tile. Pitch or length could follow army size.',
    'playMoves in board.ts, when a flight is created for your army.',
  ),
  sound(
    'tile.capture',
    'Tile captured (yours)',
    'Armies and battles',
    'A satisfying claim: a bright stamp or flag-plant. Also what an army arriving on empty ground sounds like (and an attack that wins the tile). Pitch or weight can step up for villages and cities.',
    'A tile changing to your colour. Variants for farm, village and city could share this id with a pitch change.',
  ),
  sound(
    'tile.lost',
    'Tile lost',
    'Armies and battles',
    'A downward, hollow cue when an enemy takes one of your tiles. Heavier for villages and cities.',
    'One of your tiles changing to someone else.',
  ),
  sound(
    'tile.captureFailed',
    'Failed to capture a tile',
    'Armies and battles',
    'A flat, deflated thud: your attack was beaten, or both armies were wiped out, and the tile stays as it was.',
    'Your attack on a held tile ending without the tile changing to you (the battle flight with won: false).',
  ),
  sound(
    'tile.defended',
    'Defended a tile',
    'Armies and battles',
    'A solid, reassuring block: an enemy attack on your tile was beaten off and it stays yours.',
    'An attack on one of your tiles ending with the tile still yours (the defender holding).',
  ),
  // -- Players and results ---------------------------------------------------------------
  sound(
    'player.out',
    'Another player is out',
    'Players and results',
    'A low gong or drum hit as someone drops out of the match.',
    'The "is out of the match" toast (announceOut), alongside ui.notice.',
  ),
  sound(
    'result.defeat',
    'Defeat card',
    'Players and results',
    'A somber descending phrase as the Defeat card appears (you are out, the match goes on). Also used when you confirm a surrender.',
    'The Out card showing (cardReady with eliminated), and confirming Surrender in the HUD.',
  ),
  sound(
    'result.gameOver',
    'Game over card',
    'Players and results',
    'A final, resolved ending cue as the GAME OVER card appears.',
    'The Results card showing when you did not win.',
  ),
  sound(
    'result.victory',
    'Victory card',
    'Players and results',
    'A triumphant fanfare as the Victory! card appears. The longest sound in the game.',
    'The Results card showing when you won.',
  ),
  // -- Tutorial --------------------------------------------------------------------------
  sound(
    'tutorial.next',
    'Next page',
    'Tutorial',
    'A page-turn or soft slide.',
    'Next/Back buttons in the tutorial card, and moving on to the next lesson.',
  ),
  sound(
    'tutorial.task',
    'Task complete',
    'Tutorial',
    'A cheerful success chime as the Next button lights up.',
    'A tutorial step turning done (Tutorial.tsx, the rings around Next).',
  ),
  sound(
    'tutorial.fail',
    'Task failed',
    'Tutorial',
    'A gentle "not quite" buzz as the failure message appears.',
    'A tutorial step failing (view.failure set).',
  ),
  sound(
    'tutorial.finished',
    'Tutorial finished',
    'Tutorial',
    'The big celebratory sting for the Congratulations card.',
    'The tutorial-complete card appearing.',
  ),
];

export const SOUND_BY_ID: ReadonlyMap<string, SoundDef> = new Map(
  SOUNDS.map((entry) => [entry.id, entry]),
);
