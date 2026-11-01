import { describe, expect, it } from 'vitest';
import type { SqliteVectorIndex } from '../../src/sqlite/vector-index.ts';
import { nativeVectorCandidateOwners } from '../../src/sqlite/vector-candidates.ts';

function index(rows: (limit: number) => Array<{ owner: number }>) {
  const calls: number[] = [];
  const candidate = { ready: () => ({}), candidates: (_generation: number, _vector: Uint8Array, limit: number) => { calls.push(limit); return rows(limit); } };
  return { value: candidate as unknown as SqliteVectorIndex, calls };
}

describe('native distinct-owner candidate budgets', () => {
  it('expands duplicate chunks to the requested owner budget without exceeding the chunk cap', () => {
    const fake = index(limit => Array.from({ length: limit }, (_, i) => ({ owner: Math.floor(i / 2) + 1 })));
    const owners = nativeVectorCandidateOwners(fake.value, 1, new Uint8Array(), null, undefined, 2048);
    expect(owners).toHaveLength(2048); expect(new Set(owners).size).toBe(2048);
    expect(fake.calls).toEqual([2048, 4096]);
  });
  it('falls back when duplicate owners exhaust the cap or an incomplete page', () => {
    const capped = index(limit => Array.from({ length: limit }, () => ({ owner: 1 })));
    expect(nativeVectorCandidateOwners(capped.value, 1, new Uint8Array(), null, undefined, 2048)).toBeUndefined();
    expect(capped.calls).toEqual([2048, 4096]);
    const short = index(() => [{ owner: 1 }]);
    expect(nativeVectorCandidateOwners(short.value, 1, new Uint8Array(), null, undefined, 1024)).toBeUndefined();
    expect(short.calls).toEqual([1024]);
  });
  it('preserves the legacy owner target for callers without a wider query window', () => {
    const fake = index(limit => Array.from({ length: limit }, (_, i) => ({ owner: i + 1 })));
    expect(nativeVectorCandidateOwners(fake.value, 1, new Uint8Array(), null)).toHaveLength(256);
    expect(fake.calls).toEqual([256]);
  });
  it('refuses invalid targets and corrupt owner identities', () => {
    for (const target of [0, -1, 4097, NaN, 1.5]) {
      const fake = index(() => []);
      expect(() => nativeVectorCandidateOwners(fake.value, 1, new Uint8Array(), null, undefined, target))
        .toThrow(expect.objectContaining({ code: 'VALUE_INVALID' }));
      expect(fake.calls).toEqual([]);
    }
    for (const owner of [0, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      const fake = index(() => [{ owner }]);
      expect(() => nativeVectorCandidateOwners(fake.value, 1, new Uint8Array(), null))
        .toThrow(expect.objectContaining({ code: 'CORRUPT' }));
    }
  });
});
