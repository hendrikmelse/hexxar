export { ARCHETYPE_IDS, type ArchetypeId } from './archetypes/index.js';
export { CHOKE_MAX_WIDTH, type Choke, type RoyaleMetrics } from './analyze.js';
export {
  corridorPath,
  type Blueprint,
  type Chamber,
  type Corridor,
  type Point,
} from './blueprint.js';
export { depthFromCoast } from './grid.js';
export { measureFairness, territories, type Fairness, type Territories } from './fairness.js';
export { placeVillages, type VillageSummary } from './villages.js';
export {
  generateRoyaleLayout,
  royaleTargetTiles,
  type Rejection,
  type RoyaleInput,
  type RoyaleLayout,
  type RoyaleReport,
} from './generate.js';
