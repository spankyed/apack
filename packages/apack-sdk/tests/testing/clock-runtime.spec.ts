// startTestRuntime({ clock }) threads the same clock to both the app engine and lazy testRunHistory(),
// and keeps using that clock across resetTestData().
import * as os from 'node:os';
import { describe, expect, it } from 'vitest';
import type { EarsClock } from '@elmdb/ears';
import { boundEars, untypedCreate } from '../../src/ears/index.ts';
import { addTestSecret, resetTestData, startTestRuntime, testRunHistory } from '../../src/testing/index.ts';

process.env.APACK_ENV ??= 'test';
process.env.APACK_USER_DATA_DIR ??= os.tmpdir();

let wallMs = 1_700_000_000_000;
const clock: EarsClock = {
  now: () => wallMs,
  monotonic: () => wallMs - 1_700_000_000_000,
  after: (_ms, _run) => () => {},
};

startTestRuntime({ entityTypes: ['Memo'], clock });

describe('startTestRuntime({ clock })', () => {
  it('drives both the app engine and testRunHistory() across resetTestData()', () => {
    const id = untypedCreate('Memo', { text: 'one' }).id();
    expect(boundEars().getRow(id)?.createdAt).toBe(wallMs);

    const run1 = testRunHistory().start({ kind: 'flow', label: 'first', flowId: 'Flow-1' });
    expect(run1.startedAt).toBe(wallMs);

    wallMs += 4_000;
    testRunHistory().finish(run1.id, 'completed');
    expect(testRunHistory().get(run1.id)?.completedAt).toBe(wallMs);

    // resetTestData() replaces both databases while preserving the configured clock
    resetTestData();
    wallMs += 6_000;
    const id2 = untypedCreate('Memo', { text: 'two' }).id();
    expect(boundEars().getRow(id2)?.createdAt).toBe(wallMs);

    const run2 = testRunHistory().start({ kind: 'flow', label: 'second', flowId: 'Flow-2' });
    expect(run2.startedAt).toBe(wallMs);

    const secret = addTestSecret('openai', 'test-key');
    expect(secret.createdAt).toBe(wallMs);
  });
});
