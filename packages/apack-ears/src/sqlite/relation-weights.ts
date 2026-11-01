// Match the shared edge/seed domain; the bound keeps finite sums for fewer than 2^32 edges.
export const MAX_RELATION_WEIGHT = 2 ** 960;
export function validRelationWeight(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && value <= MAX_RELATION_WEIGHT;
}
export function relationWeight(weighted: boolean, kind: string, value: unknown): number | undefined {
  if (value === undefined) return;
  if (!weighted || !validRelationWeight(value))
    throw Object.assign(new Error(`A ${kind} relation requires a declared weighted kind and a weight from 0 to 2^960`), { code: 'VALUE_INVALID' });
  return value === 1 ? undefined : value === 0 ? 0 : value;
}
