import { describe, expect, it } from 'vitest';
import { createRecordingBuffer } from '../../src/diagnostics/buffer.ts';

describe('bounded recording', () => {
  it('refuses oversized observations without consuming the remaining budget', () => {
    const buffer = createRecordingBuffer<string>({ observations: 2, bytes: 5 });
    expect(buffer.append('oversized', 6)).toBe(false);
    expect(buffer.append('a', 2)).toBe(true);
    expect(buffer.append('b', 3)).toBe(true);
    expect(buffer.append('c', 0)).toBe(false);
    expect(buffer.snapshot()).toEqual({ observations: ['a', 'b'], bytes: 5, dropped: 2, truncated: true });
  });

  it('returns independent snapshots and keeps an earlier report stable', () => {
    const buffer = createRecordingBuffer<string>({ observations: 2, bytes: 5 });
    buffer.append('a', 1);
    const first = buffer.snapshot();
    buffer.append('b', 1);
    expect(first.observations).toEqual(['a']);
    expect(buffer.snapshot().observations).toEqual(['a', 'b']);
  });

  it('rejects invalid accounting and accepts explicitly disabled budgets', () => {
    expect(() => createRecordingBuffer({ observations: -1, bytes: 5 })).toThrow(RangeError);
    const buffer = createRecordingBuffer({ observations: 0, bytes: 0 });
    expect(buffer.append({}, 0)).toBe(false);
    expect(() => buffer.append({}, NaN)).toThrow(RangeError);
  });
});
