// The one case in `spec-plan`'s subject that starts a vitest of its own: asking the run the planner chose to
// collect, and checking that what comes back is from the root the planner picked.
//
// Its own file because of what it costs, not what it does. Beside `spec-plan`'s 112 pure cases this one
// subprocess put that file across the cost band — 2.8s measured in the fast half, 1.4s in the slow one, so
// the gate asked for a move in both directions at once. Alone it is a second, which is a fast spec that
// happens to spawn: the halves are about cost, and this case is cheap enough for either.
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { planTargets } from '../../../scripts/lib/spec-plan.ts';
import { collectFor } from '../../../scripts/lib/spec-dry.ts';

describe('what the plan would run', () => {
  it('collects the workspace specs affected by a source file', async () => {
    const target = 'packages/apack-cli/src/build/pack-rules.ts';
    const run = planTargets([target], [], REPO_ROOT).runs.find((r) => r.collects !== undefined)!;
    expect(run.cwd).toBe(REPO_ROOT);

    const collected = await collectFor(run, REPO_ROOT);

    expect(collected, `nothing collected for ${target}, so the prediction would read as free`).not.toEqual([]);
    expect(collected.some((spec) => spec.startsWith('packages/apack-cli/'))).toBe(true);
  });
});
