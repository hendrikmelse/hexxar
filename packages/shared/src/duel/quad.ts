import type { Blueprint } from '../royale/blueprint.js';
import { buildGroupBlueprint, QUAD_GROUP, type GroupBlueprintInput } from './group.js';

/**
 * A layout of blobs and corridors that maps onto itself under two mirrors at right angles (and
 * the half turn they make together), for four players: a starting blob in each quarter of the board
 * (chambers 0 to 3: the first, then its mirror image across the vertical line, across the horizontal
 * line, and through the middle), sets of extra blobs, some on one of the two lines (two blobs) and
 * some off them (four), and perhaps one blob at the middle. See `buildGroupBlueprint`.
 */
export const buildQuadBlueprint = (input: GroupBlueprintInput): Blueprint | null =>
  buildGroupBlueprint(QUAD_GROUP, input);
