import type { QueryExplanation } from '@apackdev/ears';

/** Whether a console result is what a query's `explain()` answers, which the console shows as its plan's stages */
export function isExplanation(value: unknown): value is QueryExplanation {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const { ids, stages, visited, ms } = value as Record<string, unknown>;
  return Array.isArray(ids) && typeof visited === 'number' && typeof ms === 'number' && Array.isArray(stages)
    && stages.every((stage) => stage !== null && typeof stage === 'object' && typeof (stage as { stage?: unknown }).stage === 'string');
}
