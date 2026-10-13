import { buildScattered } from './scattered.js';
import type { Archetype } from './types.js';

export const ARCHETYPES = [
  { id: 'scattered', build: buildScattered },
] as const satisfies readonly Archetype[];

export type ArchetypeId = (typeof ARCHETYPES)[number]['id'];

export const ARCHETYPE_IDS: readonly ArchetypeId[] = ARCHETYPES.map((a) => a.id);

export const archetypeById = (id: ArchetypeId): Archetype =>
  ARCHETYPES.find((a) => a.id === id) ?? ARCHETYPES[0];

export type { Archetype, ArchetypeInput } from './types.js';
