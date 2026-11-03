/** A bounded recording buffer. Callers provide encoded size; rejected observations remain visible in its report. */
export interface RecordingBuffer<T> {
  append(value: T, bytes: number): boolean;
  snapshot(): { observations: readonly T[]; bytes: number; dropped: number; truncated: boolean };
}

/** Limits apply before accepting an observation, so one oversized record cannot exceed the recording budget. */
export function createRecordingBuffer<T>(limits: { observations: number; bytes: number }): RecordingBuffer<T> {
  for (const value of [limits.observations, limits.bytes]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Recording limits must be nonnegative safe integers');
  }
  const observations: T[] = [];
  let bytes = 0;
  let dropped = 0;
  return {
    append(value, size) {
      if (!Number.isSafeInteger(size) || size < 0) throw new RangeError('Observation size must be a nonnegative safe integer');
      if (observations.length >= limits.observations || size > limits.bytes - bytes) {
        dropped++;
        return false;
      }
      observations.push(value);
      bytes += size;
      return true;
    },
    snapshot: () => ({ observations: observations.slice(), bytes, dropped, truncated: dropped !== 0 }),
  };
}
