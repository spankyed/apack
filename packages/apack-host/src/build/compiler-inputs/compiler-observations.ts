import { hash } from 'node:crypto';

/** Encoded queries/results cross thread boundaries without functions, prototypes or shared mutation. */
export interface CompilerInputObservations {
  readonly root: string;
  readonly entries: ReadonlyArray<readonly [query: string, value: string]>;
}

export function encodeCompilerObservation(value: unknown): string {
  return JSON.stringify(value, (_key, value: unknown) => {
    if (typeof value === 'bigint') return { bigint: value.toString() };
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
    }
    return value;
  }) ?? 'undefined';
}

/** Each frame has one logical root; repeated queries may agree or add facts, never replace them. */
export function createCompilerInputObservations(root: string, sources: readonly CompilerInputObservations[] = []) {
  const entries = new Map<string, string>();
  const add = (query: string, value: string) => {
    if (typeof query !== 'string' || typeof value !== 'string') throw new Error('Invalid compiler input observation');
    if (entries.has(query) && entries.get(query) !== value) throw new Error(`Conflicting compiler input observation: ${query}`);
    entries.set(query, value);
  };
  for (const source of sources) {
    if (source.root !== root) throw new Error('Compiler input observation roots differ');
    for (const [query, value] of source.entries) add(query, value);
  }
  return {
    record(query: readonly unknown[], value: unknown) { add(encodeCompilerObservation(query), encodeCompilerObservation(value)); },
    snapshot(): CompilerInputObservations {
      return { root, entries: [...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0) };
    },
  };
}

export function hashCompilerInputObservations(observations: CompilerInputObservations): string {
  return hash('sha256', JSON.stringify(observations.entries), 'hex');
}
