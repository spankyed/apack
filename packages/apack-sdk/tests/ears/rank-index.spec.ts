import { describe, expect, it } from 'vitest';
import { untypedCreate, untypedQuery, untypedWrite } from '../../src/ears/index.ts';
import { startTestRuntime, waitForIndexBuilds } from '../../src/testing/index.ts';

describe('a rank index in the test runtime', () => {
  it('reads what a later call declared, settled once the builds are waited for', () => {
    startTestRuntime({ entityTypes: ['RankedNote'], relationKinds: ['ranked_refs'] });
    const [hub, ...rest] = ['a', 'b', 'c'].map((title) => untypedCreate('RankedNote', { title }).id()) as [string, ...string[]];
    for (const note of rest) untypedWrite(note as never).link('ranked_refs', hub as never);

    startTestRuntime({ ranks: { rankedNotes: { types: ['RankedNote'], relations: ['ranked_refs'] } } });
    waitForIndexBuilds();
    expect(untypedQuery('RankedNote').ranked('rankedNotes').limit(1).ids()).toEqual([hub]);
  });
});
